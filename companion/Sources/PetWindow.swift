import AppKit

/// 桌宠悬浮窗：透明、无边框、永远置顶；可拖动，位置持久化。
final class PetWindow: NSWindow {
    static let windowSize = NSSize(width: 380, height: 560)

    let webView: PetWebView
    private var dragMonitor: Any?

    init(host: HostClient) {
        webView = PetWebView(host: host)
        let origin = PetWindow.restoreOrigin()
        super.init(
            contentRect: NSRect(origin: origin, size: PetWindow.windowSize),
            styleMask: [.borderless],
            backing: .buffered,
            defer: false
        )
        isOpaque = false
        backgroundColor = .clear
        hasShadow = false
        level = .floating
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        isMovable = false
        contentView = webView

        NotificationCenter.default.addObserver(
            forName: NSWindow.didMoveNotification,
            object: self,
            queue: .main
        ) { [weak self] _ in
            self?.saveOrigin()
        }
    }

    // 无边框窗口必须能成为 key/main，输入框才能获得键盘焦点
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }

    // MARK: - 页面状态推送

    func notifyConnection(_ online: Bool) {
        webView.eval(online
            ? "window.petBridge && window.petBridge.renderOnline()"
            : "window.petBridge && window.petBridge.renderOffline()")
    }

    func notifyMemoryCleared() {
        webView.eval("window.petBridge && window.petBridge.clearTranscript()")
    }

    // MARK: - 动态窗口尺寸（JS 布局消息驱动）

    /// 图标尺寸持久化键。
    private static let iconSizeKey = "petIconSize"

    /// 按 JS 布局消息调整窗口：底边锚定不动（桌宠原地），宽度/高度自适应。
    func applyLayout(mode: String, width: CGFloat, height: CGFloat, iconSize: CGFloat) {
        guard width > 40, height > 40 else { return }
        if iconSize > 0 {
            UserDefaults.standard.set(Double(iconSize), forKey: PetWindow.iconSizeKey)
        }
        let target = NSRect(
            x: frame.midX - width / 2,
            y: frame.minY,
            width: width,
            height: height
        )
        guard target != frame else { return }
        NSAnimationContext.runAnimationGroup { context in
            context.duration = 0.18
            context.allowsImplicitAnimation = true
            animator().setFrame(target, display: true)
        }
    }

    // MARK: - 拖动（JS 判定拖动手势后调用）

    func beginDrag() {
        guard dragMonitor == nil else { return }
        dragMonitor = NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDragged, .leftMouseUp]) { [weak self] event in
            guard let self else { return event }
            switch event.type {
            case .leftMouseDragged:
                var origin = self.frame.origin
                origin.x += event.deltaX
                origin.y -= event.deltaY
                self.setFrameOrigin(origin)
            case .leftMouseUp:
                self.endDrag()
            default:
                break
            }
            return event
        }
    }

    private func endDrag() {
        if let monitor = dragMonitor {
            NSEvent.removeMonitor(monitor)
            dragMonitor = nil
        }
    }

    // MARK: - 位置持久化

    private func saveOrigin() {
        UserDefaults.standard.set(NSStringFromRect(frame), forKey: "petWindowFrame")
    }

    private static func restoreOrigin() -> NSPoint {
        if let stored = UserDefaults.standard.string(forKey: "petWindowFrame") {
            let rect = NSRectFromString(stored)
            if let screen = NSScreen.main {
                let vf = screen.visibleFrame
                var p = rect.origin
                p.x = min(max(p.x, vf.minX), vf.maxX - rect.width)
                p.y = min(max(p.y, vf.minY), vf.maxY - rect.height)
                return p
            }
            return rect.origin
        }
        // 默认：主屏右下角
        if let screen = NSScreen.main {
            let vf = screen.visibleFrame
            return NSPoint(x: vf.maxX - windowSize.width - 24, y: vf.minY + 20)
        }
        return NSPoint(x: 100, y: 100)
    }
}
