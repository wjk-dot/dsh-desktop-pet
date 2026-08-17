import Foundation

/// Host 客户端：读端口桥、健康探测和原生会话 SSE 投影。
/// 对话走原生 URLSession（非浏览器，无 CORS），loopback 直连 DSH host。
final class HostClient: NSObject, URLSessionDataDelegate {
    /// 原生壳要执行的 JS 脚本（由 AppDelegate 桥接到 WebView）。
    var onEval: ((String) -> Void)?
    /// 连接状态变化（主线程回调）。
    var onConnectionChange: ((Bool) -> Void)?
    /// 桌宠开关变化（主线程回调；原生状态栏入口控制）。
    var onEnabledChange: ((Bool) -> Void)?
    /// DSH 宿主进程退出回调（生命周期联动：伴生应用随之退出）。
    var onHostExit: (() -> Void)?

    /// 当前桌宠是否启用（来自桥文件；关闭时禁止对话）。
    private(set) var isEnabled = true
    private var lastEnabled: Bool?

    private let homeDir: URL
    private var baseURL: URL?
    private var bridgeTimer: Timer?
    private var healthTimer: Timer?
    private var pidTimer: Timer?
    private var hostPid: pid_t?
    private var pidDeadCount = 0
    private var chatSession: URLSession!
    private var eventTask: URLSessionDataTask?
    private var eventBuffer = Data()
    private var lastEventSequence = 0
    private var bridgeInstanceId: String?
    private var reconnectWorkItem: DispatchWorkItem?
    private var reconnectAfterCancellation = false
    private var refreshPending = false

    // 当前进行中的对话
    private var currentTask: URLSessionDataTask?
    private var sseBuffer = Data()
    private var replyText = ""
    private var chatInFlight = false
    private var lastOnline: Bool?
    // One explicit, user-selected screenshot waits here until the user writes
    // and sends a question. It is never submitted merely because it was taken.
    private var pendingVisionImage: Data?
    private var pendingVisionName: String?

    init(homeDir: URL? = nil) {
        if let homeDir {
            self.homeDir = homeDir
        } else {
            let env = ProcessInfo.processInfo.environment["DSH_HOME"]
            if let env, !env.isEmpty {
                self.homeDir = URL(fileURLWithPath: env)
            } else {
                self.homeDir = FileManager.default
                    .homeDirectoryForCurrentUser
                    .appendingPathComponent(".dsh")
            }
        }
        super.init()
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 120
        chatSession = URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }

    // MARK: - 生命周期

    func start() {
        reloadBridge()
        // Bridge 是租约，不是 UI 状态轮询；只用于发现 host replacement。
        let bridgeTimer = Timer(timeInterval: 1.0, repeats: true) { [weak self] _ in
            self?.reloadBridge()
        }
        RunLoop.main.add(bridgeTimer, forMode: .common)
        self.bridgeTimer = bridgeTimer

        let timer = Timer(timeInterval: 5.0, repeats: true) { [weak self] _ in
            self?.checkHealth()
        }
        RunLoop.main.add(timer, forMode: .common)
        healthTimer = timer
        // 生命周期联动：监视桥文件里的 host PID，DSH 彻底退出后伴生应用一起退出。
        let pidTimer = Timer(timeInterval: 2.0, repeats: true) { [weak self] _ in
            self?.checkHostPid()
        }
        RunLoop.main.add(pidTimer, forMode: .common)
        self.pidTimer = pidTimer

        checkHealth()
        fetchHistory()
        fetchStatus()
        fetchPreferences()
        connectEvents()
    }

    func stop() {
        bridgeTimer?.invalidate()
        healthTimer?.invalidate()
        pidTimer?.invalidate()
        currentTask?.cancel()
        eventTask?.cancel()
        reconnectWorkItem?.cancel()
        reconnectAfterCancellation = false
    }

    /// 检查桥文件 host PID 是否存活；连续三次（约 6s）"PID 失活且健康检查离线"
    /// 才回调退出（伴生应用与 DSH 生命周期绑定）。宽限避免宿主重启瞬时误退：
    /// 重启时新 host 会快速重写桥文件（新 PID），桥轮询随即恢复判定。
    private func checkHostPid() {
        guard let pid = hostPid, pid > 0 else { return }
        let alive = (kill(pid, 0) == 0) || (errno == EPERM)
        if alive || lastOnline != false {
            pidDeadCount = 0
        } else {
            pidDeadCount += 1
            if pidDeadCount >= 3 {
                DispatchQueue.main.async { self.onHostExit?() }
            }
        }
    }

    // MARK: - 端口桥

    private func bridgeFileURL() -> URL {
        homeDir.appendingPathComponent("pet-bridge.json")
    }

    /// 重新读取桥文件（端口每次启动可能变化；enabled 变化时通知壳隐藏/显示）。
    func reloadBridge() {
        guard let data = try? Data(contentsOf: bridgeFileURL()),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let port = obj["port"] as? Int, port > 0,
              let expiresAt = obj["expiresAt"] as? Double,
              expiresAt > Date().timeIntervalSince1970 * 1000 else {
            baseURL = nil
            return
        }
        let newBase = URL(string: "http://127.0.0.1:\(port)")
        let newInstanceId = obj["instanceId"] as? String
        let replaced = baseURL != newBase || bridgeInstanceId != newInstanceId
        baseURL = newBase
        bridgeInstanceId = newInstanceId
        if let pid = obj["pid"] as? Int, pid > 0 {
            hostPid = pid_t(pid)
        }
        if let enabled = obj["enabled"] as? Bool {
            isEnabled = enabled
            if enabled != lastEnabled {
                lastEnabled = enabled
                DispatchQueue.main.async { self.onEnabledChange?(enabled) }
            }
        }
        if replaced {
            lastEventSequence = 0
            reconnectWorkItem?.cancel()
            if eventTask != nil {
                reconnectAfterCancellation = true
                eventTask?.cancel()
            } else {
                connectEvents()
            }
            fetchHistory()
            fetchStatus()
            fetchPreferences()
        }
    }

    // MARK: - 健康轮询

    func checkHealth() {
        reloadBridge()
        guard let base = baseURL else {
            setOnline(false)
            return
        }
        var req = request(base.appendingPathComponent("/api/pet/health"))
        req.timeoutInterval = 3
        URLSession.shared.dataTask(with: req) { [weak self] _, resp, _ in
            let ok = (resp as? HTTPURLResponse)?.statusCode == 200
            DispatchQueue.main.async { self?.setOnline(ok) }
        }.resume()
    }

    private func setOnline(_ online: Bool) {
        if lastOnline == online { return }
        lastOnline = online
        onConnectionChange?(online)
    }

    private func request(_ url: URL) -> URLRequest {
        var req = URLRequest(url: url)
        if let bridgeInstanceId {
            req.setValue(bridgeInstanceId, forHTTPHeaderField: "X-Pet-Instance")
        }
        return req
    }

    // MARK: - Reactive session event stream

    private func connectEvents() {
        guard eventTask == nil, let base = baseURL else { return }
        var req = request(base.appendingPathComponent("/api/pet/events"))
        if lastEventSequence > 0 {
            var components = URLComponents(url: req.url!, resolvingAgainstBaseURL: false)!
            components.queryItems = [URLQueryItem(name: "after", value: String(lastEventSequence))]
            req.url = components.url
        }
        req.timeoutInterval = 0
        req.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        eventBuffer = Data()
        eventTask = chatSession.dataTask(with: req)
        eventTask?.resume()
    }

    private func scheduleEventReconnect() {
        reconnectWorkItem?.cancel()
        let work = DispatchWorkItem { [weak self] in self?.connectEvents() }
        reconnectWorkItem = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0, execute: work)
    }

    private func scheduleProjectionRefresh() {
        guard !refreshPending else { return }
        refreshPending = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.12) { [weak self] in
            self?.refreshPending = false
            self?.fetchStatus()
            self?.fetchHistory()
        }
    }

    private func scheduleStatusRefresh() {
        guard !refreshPending else { return }
        refreshPending = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.12) { [weak self] in
            self?.refreshPending = false
            self?.fetchStatus()
        }
    }

    // MARK: - 对话

    func sendChat(_ text: String) {
        guard !chatInFlight else { return }
        guard isEnabled else {
            evalJS("window.petBridge && window.petBridge.renderError(\"\\u684c\\u5ba0\\u5df2\\u5173\\u95ed\")") // 桌宠已关闭
            return
        }
        guard let base = baseURL else {
            evalJS("window.petBridge && window.petBridge.renderError(\"\\u0044\\u0053\\u0048 \\u672a\\u8fd0\\u884c\")")
            return
        }
        startRequest(base: base, path: "/api/pet/chat", body: ["message": text])
    }

    /// Open the native selector and retain the resulting image locally. The
    /// follow-up text submission is intentionally a separate user action.
    func captureForLaterAnalysis() {
        guard !chatInFlight else { return }
        guard isEnabled else {
            evalJS("window.petBridge && window.petBridge.captureFailed(\"\\u684c\\u5ba0\\u5df2\\u5173\\u95ed\")")
            return
        }
        guard baseURL != nil else {
            evalJS("window.petBridge && window.petBridge.captureFailed(\"DSH \\u672a\\u8fd0\\u884c\")")
            return
        }
        ScreenCapture.captureInteractiveJPEG { [weak self] result in
            DispatchQueue.main.async {
                guard let self else { return }
                switch result {
                case .success(let image):
                    self.pendingVisionImage = image
                    self.pendingVisionName = "selected-screenshot.jpg"
                    self.evalJS("window.petBridge && window.petBridge.captureReady()")
                case .failure(let error):
                    self.evalJS("window.petBridge && window.petBridge.captureFailed(\(Self.jsString(error.localizedDescription)))")
                }
            }
        }
    }

    func sendPendingVision(_ prompt: String) {
        guard !chatInFlight else { return }
        guard isEnabled else {
            evalJS("window.petBridge && window.petBridge.renderError(\"\\u684c\\u5ba0\\u5df2\\u5173\\u95ed\")")
            return
        }
        guard let base = baseURL else {
            evalJS("window.petBridge && window.petBridge.renderError(\"DSH \\u672a\\u8fd0\\u884c\")")
            return
        }
        guard let image = pendingVisionImage else {
            evalJS("window.petBridge && window.petBridge.renderError(\"请先选择截图\")")
            return
        }
        pendingVisionImage = nil
        let name = pendingVisionName ?? "selected-screenshot.jpg"
        pendingVisionName = nil
        startRequest(base: base, path: "/api/pet/vision", body: [
            "data": image.base64EncodedString(),
            "name": name,
            "prompt": prompt,
        ], timeout: 120)
    }

    func discardPendingVision() {
        pendingVisionImage = nil
        pendingVisionName = nil
    }

    private func startRequest(base: URL, path: String, body: [String: Any], timeout: TimeInterval? = nil) {
        chatInFlight = true
        replyText = ""
        sseBuffer = Data()
        var req = request(base.appendingPathComponent(path))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let timeout { req.timeoutInterval = timeout }
        req.httpBody = try? JSONSerialization.data(withJSONObject: body)
        currentTask = chatSession.dataTask(with: req)
        currentTask?.resume()
    }

    /// 中止同一原生 session 的当前 Agent turn，不依赖 SSE 连接是否仍在。
    func cancelTurn() {
        guard let base = baseURL else { return }
        var req = request(base.appendingPathComponent("/api/pet/cancel"))
        req.httpMethod = "POST"
        URLSession.shared.dataTask(with: req) { [weak self] data, response, _ in
            let ok = (response as? HTTPURLResponse)?.statusCode == 200
            DispatchQueue.main.async {
                if ok {
                    self?.evalJS("window.petBridge && window.petBridge.renderActivity({name:'任务',state:'done'})")
                } else if let data,
                          let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                          let message = obj["error"] as? String {
                    self?.evalJS("window.petBridge && window.petBridge.renderError(\(Self.jsString(message)))")
                }
            }
        }.resume()
    }

    /// The status item is the reliable control surface. It changes host state,
    /// rather than merely hiding this one native window locally.
    func setEnabled(_ enabled: Bool) {
        guard let base = baseURL else { return }
        var req = request(base.appendingPathComponent("/api/pet/control"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["enabled": enabled])
        URLSession.shared.dataTask(with: req) { [weak self] data, response, _ in
            guard (response as? HTTPURLResponse)?.statusCode == 200,
                  let data,
                  let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let applied = obj["enabled"] as? Bool else { return }
            self?.isEnabled = applied
            DispatchQueue.main.async { self?.onEnabledChange?(applied) }
        }.resume()
    }

    /// 原生 Agent 状态轮询：桌面端和桌宠端发起的任务共用这份状态。
    func fetchStatus() {
        reloadBridge()
        guard let base = baseURL else { return }
        var req = request(base.appendingPathComponent("/api/pet/status"))
        req.timeoutInterval = 2
        URLSession.shared.dataTask(with: req) { [weak self] data, _, _ in
            guard let data,
                  let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let status = obj["status"],
                  let json = try? JSONSerialization.data(withJSONObject: status),
                  let script = String(data: json, encoding: .utf8) else { return }
            DispatchQueue.main.async {
                self?.evalJS("window.petBridge && window.petBridge.updateAgentStatus(\(script))")
            }
        }.resume()
    }

    /// 拉取 host 端会话记录，推给页面显示（启动/恢复在线时调用）。
    func fetchHistory() {
        reloadBridge()
        guard let base = baseURL else { return }
        var req = request(base.appendingPathComponent("/api/pet/history"))
        req.timeoutInterval = 5
        URLSession.shared.dataTask(with: req) { [weak self] data, _, _ in
            guard let data,
                  let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let turns = obj["turns"] as? [[String: Any]] else { return }
            let trimmed: [[String: Any]] = turns.map { t in
                ["role": t["role"] ?? "assistant", "content": t["content"] ?? ""]
            }
            guard let json = try? JSONSerialization.data(withJSONObject: trimmed),
                  let script = String(data: json, encoding: .utf8) else { return }
            DispatchQueue.main.async {
                self?.evalJS("window.petBridge && window.petBridge.loadHistory(\(script))")
            }
        }.resume()
    }

    /// 拉取桌宠外观偏好；配置页写入后也由 SSE 推送，无需重启伴生应用。
    func fetchPreferences() {
        reloadBridge()
        guard let base = baseURL else { return }
        var req = request(base.appendingPathComponent("/api/pet/preferences"))
        req.timeoutInterval = 3
        URLSession.shared.dataTask(with: req) { [weak self] data, _, _ in
            guard let data,
                  let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let preferences = obj["preferences"],
                  let json = try? JSONSerialization.data(withJSONObject: preferences),
                  let script = String(data: json, encoding: .utf8) else { return }
            DispatchQueue.main.async {
                self?.evalJS("window.petBridge && window.petBridge.applyPreferences(\(script))")
            }
        }.resume()
    }

    private func evalJS(_ script: String) {
        onEval?(script)
    }

    /// 把 Swift 字符串转成合法的 JS 字符串字面量（JSON 转义）。
    /// 不依赖 NSJSONSerialization：裸字符串顶层序列化会抛 ObjC 异常（SIGABRT），
    /// 手写转义器根除该类崩溃。
    private static func jsString(_ s: String) -> String {
        var out = "\""
        for scalar in s.unicodeScalars {
            switch scalar {
            case "\\": out += "\\\\"
            case "\"": out += "\\\""
            case "\n": out += "\\n"
            case "\r": out += "\\r"
            case "\t": out += "\\t"
            case "\u{08}": out += "\\b"
            case "\u{0C}": out += "\\f"
            case let c where c.value < 0x20 || c.value == 0x2028 || c.value == 0x2029:
                out += String(format: "\\u%04x", c.value)
            default:
                out.unicodeScalars.append(scalar)
            }
        }
        out += "\""
        return out
    }

    // MARK: - URLSessionDataDelegate（SSE 流式）

    func urlSession(
        _ session: URLSession,
        dataTask: URLSessionDataTask,
        didReceive response: URLResponse,
        completionHandler: @escaping (URLSession.ResponseDisposition) -> Void
    ) {
        if dataTask == eventTask {
            if let http = response as? HTTPURLResponse, http.statusCode != 200 {
                completionHandler(.cancel)
                return
            }
            completionHandler(.allow)
            return
        }
        if let http = response as? HTTPURLResponse, http.statusCode != 200 {
            evalJS("window.petBridge && window.petBridge.renderError(\"HTTP \\(http.statusCode)\")")
            chatInFlight = false
            completionHandler(.cancel)
            return
        }
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        if dataTask == eventTask {
            eventBuffer.append(data)
            parseEventStream()
            return
        }
        sseBuffer.append(data)
        parseSSE()
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if task == eventTask {
            eventTask = nil
            let cancelled = (error as NSError?)?.code == NSURLErrorCancelled
            if reconnectAfterCancellation {
                reconnectAfterCancellation = false
                connectEvents()
            } else if !cancelled {
                scheduleEventReconnect()
            }
            return
        }
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            if let error, (error as NSError).code != NSURLErrorCancelled {
                self.evalJS("window.petBridge && window.petBridge.renderError(\(Self.jsString(error.localizedDescription)))")
                self.chatInFlight = false
            } else if self.chatInFlight {
                // 流结束但未见 done（如连接被掐断）：按完成处理
                self.evalJS("window.petBridge && window.petBridge.renderDone()")
                self.chatInFlight = false
            }
            self.currentTask = nil
        }
    }

    private func parseEventStream() {
        let separator = Data("\n\n".utf8)
        while let range = eventBuffer.range(of: separator) {
            let frame = eventBuffer.subdata(in: eventBuffer.startIndex..<range.lowerBound)
            eventBuffer.removeSubrange(eventBuffer.startIndex..<range.upperBound)
            guard let text = String(data: frame, encoding: .utf8) else { continue }
            var payload: String?
            for line in text.split(separator: "\n", omittingEmptySubsequences: false) {
                if line.hasPrefix("id:"), let seq = Int(line.dropFirst(3).trimmingCharacters(in: .whitespaces)) {
                    lastEventSequence = max(lastEventSequence, seq)
                }
                if line.hasPrefix("data:") {
                    payload = String(line.dropFirst(5)).trimmingCharacters(in: .whitespaces)
                }
            }
            guard let payload,
                  let data = payload.data(using: .utf8),
                  let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { continue }
            if let seq = obj["seq"] as? Int { lastEventSequence = max(lastEventSequence, seq) }
            if let type = obj["type"] as? String, type == "control",
               let state = obj["data"] as? [String: Any], let enabled = state["enabled"] as? Bool {
                isEnabled = enabled
                lastEnabled = enabled
                DispatchQueue.main.async { self.onEnabledChange?(enabled) }
            }
            if let type = obj["type"] as? String, type == "preferences",
               let data = obj["data"] as? [String: Any], let preferences = data["preferences"],
               let json = try? JSONSerialization.data(withJSONObject: preferences),
               let script = String(data: json, encoding: .utf8) {
                DispatchQueue.main.async {
                    self.evalJS("window.petBridge && window.petBridge.applyPreferences(\(script))")
                }
            }
            let nativeType = ((obj["data"] as? [String: Any])?["event"] as? [String: Any])?["type"] as? String
            if nativeType == "assistant/chunk" {
                scheduleStatusRefresh()
            } else {
                scheduleProjectionRefresh()
            }
        }
    }

    // MARK: - SSE 帧解析

    private func parseSSE() {
        let separator = Data("\n\n".utf8)
        while let range = sseBuffer.range(of: separator) {
            let frame = sseBuffer.subdata(in: sseBuffer.startIndex..<range.lowerBound)
            sseBuffer.removeSubrange(sseBuffer.startIndex..<range.upperBound)
            guard let frameStr = String(data: frame, encoding: .utf8) else { continue }
            for line in frameStr.split(separator: "\n") {
                guard line.hasPrefix("data:") else { continue }
                let payload = line.dropFirst(5).trimmingCharacters(in: .whitespaces)
                handleEvent(payload)
            }
        }
    }

    private func handleEvent(_ payload: String) {
        guard let data = payload.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = obj["type"] as? String else { return }
        switch type {
        case "activity":
            if let activity = obj["activity"],
               let data = try? JSONSerialization.data(withJSONObject: activity),
               let json = String(data: data, encoding: .utf8) {
                evalJS("window.petBridge && window.petBridge.renderActivity(\(json))")
            }
        case "delta":
            if let text = obj["text"] as? String {
                replyText += text
                evalJS("window.petBridge && window.petBridge.renderDelta(\(Self.jsString(text)))")
            }
        case "done":
            chatInFlight = false
            evalJS("window.petBridge && window.petBridge.renderDone()")
        case "error":
            chatInFlight = false
            let msg = obj["error"] as? String ?? "未知错误"
            evalJS("window.petBridge && window.petBridge.renderError(\(Self.jsString(msg)))")
        default:
            break
        }
    }
}
