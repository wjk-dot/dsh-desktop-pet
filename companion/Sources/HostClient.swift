import Foundation

/// Host 客户端：读端口桥、健康轮询、SSE 流式对话。
/// 对话走原生 URLSession（非浏览器，无 CORS），loopback 直连 DSH host。
final class HostClient: NSObject, URLSessionDataDelegate {
    /// 原生壳要执行的 JS 脚本（由 AppDelegate 桥接到 WebView）。
    var onEval: ((String) -> Void)?
    /// 连接状态变化（主线程回调）。
    var onConnectionChange: ((Bool) -> Void)?

    private let homeDir: URL
    private var baseURL: URL?
    private var healthTimer: Timer?
    private var chatSession: URLSession!

    // 当前进行中的对话
    private var currentTask: URLSessionDataTask?
    private var sseBuffer = Data()
    private var replyText = ""
    private var chatInFlight = false
    private var lastOnline: Bool?

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
        let timer = Timer(timeInterval: 5.0, repeats: true) { [weak self] _ in
            self?.checkHealth()
        }
        RunLoop.main.add(timer, forMode: .common)
        healthTimer = timer
        checkHealth()
    }

    func stop() {
        healthTimer?.invalidate()
        currentTask?.cancel()
    }

    // MARK: - 端口桥

    private func bridgeFileURL() -> URL {
        homeDir.appendingPathComponent("pet-bridge.json")
    }

    /// 重新读取桥文件（端口每次启动可能变化）。
    func reloadBridge() {
        guard let data = try? Data(contentsOf: bridgeFileURL()),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let port = obj["port"] as? Int, port > 0 else {
            baseURL = nil
            return
        }
        baseURL = URL(string: "http://127.0.0.1:\(port)")
    }

    // MARK: - 健康轮询

    func checkHealth() {
        reloadBridge()
        guard let base = baseURL else {
            setOnline(false)
            return
        }
        var req = URLRequest(url: base.appendingPathComponent("/api/pet/health"))
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

    // MARK: - 对话

    func sendChat(_ text: String) {
        guard !chatInFlight else { return }
        guard let base = baseURL else {
            evalJS("window.petBridge && window.petBridge.renderError(\"\\u0044\\u0053\\u0048 \\u672a\\u8fd0\\u884c\")")
            return
        }
        chatInFlight = true
        replyText = ""
        sseBuffer = Data()

        var req = URLRequest(url: base.appendingPathComponent("/api/pet/chat"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let body: [String: Any] = ["message": text]
        req.httpBody = try? JSONSerialization.data(withJSONObject: body)

        currentTask = chatSession.dataTask(with: req)
        currentTask?.resume()
    }

    func clearMemory() {
        guard let base = baseURL else { return }
        var req = URLRequest(url: base.appendingPathComponent("/api/pet/memory"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["action": "clear"])
        URLSession.shared.dataTask(with: req).resume()
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
        if let http = response as? HTTPURLResponse, http.statusCode != 200 {
            evalJS("window.petBridge && window.petBridge.renderError(\"HTTP \\(http.statusCode)\")")
            chatInFlight = false
            completionHandler(.cancel)
            return
        }
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        sseBuffer.append(data)
        parseSSE()
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
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
