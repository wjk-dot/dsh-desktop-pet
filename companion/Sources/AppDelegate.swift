import AppKit

/// 应用生命周期：窗口 + 托盘 + 网络客户端装配。
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var window: PetWindow?
    private var host: HostClient?
    private var tray: NSStatusItem?

    func applicationDidFinishLaunching(_ notification: Notification) {
        let host = HostClient()
        self.host = host

        // 原生壳 → 页面推送通道：HostClient 产出 JS 脚本，由 WebView 执行
        host.onEval = { [weak self] script in
            DispatchQueue.main.async {
                self?.window?.webView.eval(script)
            }
        }

        let window = PetWindow(host: host)
        self.window = window
        window.orderFrontRegardless()

        setupTray()

        // 连接状态变化 → 页面离线/在线
        host.onConnectionChange = { [weak self] online in
            DispatchQueue.main.async {
                self?.window?.notifyConnection(online)
            }
        }
        host.start()

        // 初次上屏问候
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { [weak self] in
            self?.window?.greet()
        }

        // 调试模式：--snapshot <path> —— 注入一条长回复并导出渲染快照后退出
        let args = CommandLine.arguments
        if let i = args.firstIndex(of: "--snapshot"), args.count > i + 1 {
            let path = args[i + 1]
            let longText = "你好呀！我是小鲸鱼，住在你的桌面角落～这条是用于验证气泡布局的长回复：如果气泡没有锚定在头顶上方，它就会像之前一样一路长下来盖住我。现在你应该看到气泡老老实实待在我头顶上，不管文本有多长都不会挡住我，超出部分会在气泡内部滚动显示。怎么样，这样的布局清爽多了吧？"
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in
                // 裸字符串顶层序列化必须带 .fragmentsAllowed，否则抛 ObjC 异常
                let data = try? JSONSerialization.data(withJSONObject: longText, options: [.fragmentsAllowed])
                let json = data.flatMap { String(data: $0, encoding: .utf8) } ?? "\"\""
                self?.window?.webView.eval("window.petBridge && window.petBridge.debugLongBubble(\(json))")
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) { [weak self] in
                self?.window?.webView.captureSnapshot(to: path)
            }
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        host?.stop()
    }

    private func setupTray() {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        if let button = item.button {
            button.image = NSImage(
                systemSymbolName: "bubble.left.and.bubble.right.fill",
                accessibilityDescription: "DeepSeek 桌宠"
            )
        }
        let menu = NSMenu()
        menu.addItem(NSMenuItem(
            title: "显示 / 隐藏桌宠",
            action: #selector(toggleWindow),
            keyEquivalent: ""
        ))
        menu.addItem(NSMenuItem(
            title: "清空对话记忆",
            action: #selector(clearMemory),
            keyEquivalent: ""
        ))
        menu.addItem(NSMenuItem.separator())
        menu.addItem(NSMenuItem(
            title: "退出",
            action: #selector(quitApp),
            keyEquivalent: "q"
        ))
        item.menu = menu
        tray = item
    }

    @objc private func toggleWindow() {
        guard let window else { return }
        if window.isVisible {
            window.orderOut(nil)
        } else {
            window.orderFrontRegardless()
        }
    }

    @objc private func clearMemory() {
        host?.clearMemory()
        window?.notifyMemoryCleared()
    }

    @objc private func quitApp() {
        NSApp.terminate(nil)
    }
}
