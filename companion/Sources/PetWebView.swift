import WebKit

/// 桌宠 WebView：透明渲染本地宠物页面，双向桥接：
/// - JS → Swift：WKScriptMessageHandler（chat / drag）
/// - Swift → JS：evaluateJavaScript 调 window.petBridge.*
final class PetWebView: WKWebView, WKScriptMessageHandler, WKNavigationDelegate {
    private let host: HostClient

    init(host: HostClient) {
        self.host = host
        let config = WKWebViewConfiguration()
        super.init(frame: .zero, configuration: config)
        // WKWebView 的 isOpaque 只读：透明由 drawsBackground = false + 页面透明背景实现
        setValue(false, forKey: "drawsBackground")
        navigationDelegate = self
        config.userContentController.add(self, name: "pet")
        loadPage()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    /// 宠物页面目录：优先 .app 内 Resources/pet，兜底可执行文件旁 ../Resources/pet。
    private func petResourcesURL() -> URL? {
        if let res = Bundle.main.resourceURL {
            let cand = res.appendingPathComponent("pet")
            if FileManager.default.fileExists(atPath: cand.path) { return cand }
        }
        let exe = URL(fileURLWithPath: CommandLine.arguments[0])
        let cand = exe
            .deletingLastPathComponent()
            .appendingPathComponent("../Resources/pet")
            .standardizedFileURL
        return FileManager.default.fileExists(atPath: cand.path) ? cand : nil
    }

    private func loadPage() {
        guard let dir = petResourcesURL() else {
            NSLog("pet: pet resources not found")
            return
        }
        loadFileURL(dir.appendingPathComponent("index.html"), allowingReadAccessTo: dir)
    }

    /// 在主线程执行一段 JS（供原生壳推送页面事件）。
    func eval(_ script: String) {
        evaluateJavaScript(script) { _, error in
            if let error = error {
                NSLog("pet: eval error: %@", error.localizedDescription)
            }
        }
    }

    /// 执行一段返回值的 JS（主线程），结果经回调带回。
    func evalValue(_ script: String, completion: @escaping (Any?) -> Void) {
        evaluateJavaScript(script) { value, error in
            if let error = error {
                NSLog("pet: evalValue error: %@", error.localizedDescription)
                completion(nil)
                return
            }
            completion(value)
        }
    }

    /// 调试：把当前渲染结果导出为 PNG（--snapshot 模式用，无需屏幕录制权限）。
    func captureSnapshot(to path: String) {
        let config = WKSnapshotConfiguration()
        config.rect = bounds
        takeSnapshot(with: config) { [weak self] image, error in
            guard let image, error == nil else {
                NSLog("pet: snapshot failed: %@", error?.localizedDescription ?? "unknown")
                exit(1)
            }
            guard let tiff = image.tiffRepresentation,
                  let rep = NSBitmapImageRep(data: tiff),
                  let png = rep.representation(using: .png, properties: [:]) else {
                NSLog("pet: snapshot encode failed")
                exit(1)
            }
            do {
                try png.write(to: URL(fileURLWithPath: path))
                NSLog("pet: snapshot saved to %@", path)
                exit(0)
            } catch {
                NSLog("pet: snapshot write failed: %@", error.localizedDescription)
                exit(1)
            }
        }
    }

    // MARK: - JS → Swift

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        guard message.name == "pet",
              let body = message.body as? [String: Any],
              let type = body["type"] as? String else { return }
        switch type {
        case "chat":
            guard let text = body["text"] as? String else { return }
            host.sendChat(text)
        case "drag":
            (window as? PetWindow)?.beginDrag()
        default:
            break
        }
    }
}
