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
            let longText = """
            你好！验证渲染栈对齐桌面端。

            | 列A | 列B |
            |---|---|
            | 1 | 2 |

            行内公式 \\(a^2 + b^2 = c^2\\) 和 $x^2$、`inline code`、**加粗**。

            欧拉公式 \\(e^{i\\theta} = \\cos\\theta + i\\sin\\theta\\)，复数的极坐标表示 \\(z = r(\\cos\\theta + i\\sin\\theta)\\)。

            ```python
            def hello(name):
                print(f"hi, {name}")
            ```

            块级公式：
            \\[E = mc^2\\]
            """
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in
                // 裸字符串顶层序列化必须带 .fragmentsAllowed，否则抛 ObjC 异常
                let data = try? JSONSerialization.data(withJSONObject: longText, options: [.fragmentsAllowed])
                let json = data.flatMap { String(data: $0, encoding: .utf8) } ?? "\"\""
                self?.window?.webView.eval("window.petBridge && window.petBridge.debugSimulateDone(\(json))")
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) { [weak self] in
                // 渲染后取回气泡纯文本 + ✕ 按钮状态（写进快照旁的 .txt）
                self?.window?.webView.evalValue(
                    "(function(){var c=document.getElementById('bubbleClose');var b=document.getElementById('bubble');" +
                    "var r=c?c.getBoundingClientRect():null;var br=b.getBoundingClientRect();" +
                    "return JSON.stringify({display:c?getComputedStyle(c).display:null," +
                    "rect:r?[r.left,r.top,r.width,r.height]:null,bubbleHidden:b.hidden," +
                    "bubbleRect:[br.left,br.top,br.width,br.height]," +
                    "offsetH:b.offsetHeight,scrollH:b.scrollHeight,clientH:b.clientHeight," +
                    "text:document.getElementById('bubbleText').innerText});})()"
                ) { value in
                    let text = (value as? String) ?? ""
                    let txtPath = path + ".txt"
                    try? text.write(toFile: txtPath, atomically: true, encoding: .utf8)
                    NSLog("pet: state dump written to %@ (%d chars)", txtPath, text.count)
                }
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) { [weak self] in
                self?.window?.webView.captureSnapshot(to: path)
            }
            // 第二拍：短内容快照（验证宽度自适应收缩）
            DispatchQueue.main.asyncAfter(deadline: .now() + 3.0) { [weak self] in
                self?.window?.webView.eval("window.petBridge && window.petBridge.debugLongBubble('嗨！我是小鲸鱼，点我聊天～')")
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 3.8) { [weak self] in
                self?.window?.webView.captureSnapshot(to: path + "-short.png")
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 4.5) {
                exit(0)
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
