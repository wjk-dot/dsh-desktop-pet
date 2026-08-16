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
