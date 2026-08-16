import AppKit
import QuartzCore

/// 桌宠悬浮窗：透明、无边框、永远置顶；可拖动，位置持久化；
/// 支持贴边隐藏（拖到屏幕边缘自动滑出屏幕，鼠标移到边缘热区弹回）。
final class PetWindow: NSWindow {
    static let windowSize = NSSize(width: 380, height: 560)

    /// 贴边方向。
    enum DockEdge {
        case left, right, bottom
    }

    /// 贴边后留在屏幕内的"尾巴"宽度。
    private let dockPeek: CGFloat = 48
    /// 距边缘多少以内松手视为贴边意图。
    private let dockThreshold: CGFloat = 120
    /// 弹回后鼠标离开窗口多久重新贴边。
    private let reDockDelay: TimeInterval = 2.5

    let webView: PetWebView
    private var dragMonitor: Any?

    // 贴边隐藏状态
    private var dockEdge: DockEdge?
    private var globalMonitor: Any?      // 全局鼠标移动（热区 → 弹回）
    private var clickMonitor: Any?       // 贴边期间的点击（吞掉并弹回）
    private var idleTimer: Timer?        // 弹回后的空闲重贴边
    private var lastMouseFar: Date?
    private var layoutCompact = true     // JS 布局消息同步

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
        layoutCompact = (mode == "compact")
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
        animate(to: target, duration: 0.18)
        // 尺寸变化后若处于贴边状态，重新贴边保持"尾巴"大小
        if let edge = dockEdge, let screen = screenContaining() {
            var r = frame
            switch edge {
            case .left: r.origin.x = screen.frame.minX - r.width + dockPeek
            case .right: r.origin.x = screen.frame.maxX - dockPeek
            case .bottom: r.origin.y = screen.frame.minY - r.height + dockPeek
            }
            animate(to: r, duration: 0.18)
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
        maybeDock()
    }

    // MARK: - 贴边隐藏

    /// 松手后若窗口贴近屏幕边缘 → 贴边。
    private func maybeDock() {
        guard layoutCompact, dockEdge == nil,
              let screen = screenContaining() else { return }
        let f = frame
        let sf = screen.frame
        var edge: DockEdge?
        if f.minX - sf.minX < dockThreshold {
            edge = .left
        } else if sf.maxX - f.maxX < dockThreshold {
            edge = .right
        } else if f.minY - sf.minY < dockThreshold {
            edge = .bottom
        }
        if let edge { dock(to: edge) }
    }

    private func dock(to edge: DockEdge) {
        dockEdge = edge
        idleTimer?.invalidate()
        idleTimer = nil
        lastMouseFar = nil
        startMonitors()
        animate(to: dockedFrame(for: edge), duration: 0.28)
    }

    private func undock() {
        guard let edge = dockEdge else { return }
        dockEdge = nil
        stopMonitors()
        animate(to: fullFrame(for: edge), duration: 0.22)
        startIdleTimer()
    }

    /// 贴边位置：只留"尾巴"在屏幕内。
    private func dockedFrame(for edge: DockEdge) -> NSRect {
        guard let screen = screenContaining() else { return frame }
        var r = frame
        switch edge {
        case .left: r.origin.x = screen.frame.minX - r.width + dockPeek
        case .right: r.origin.x = screen.frame.maxX - dockPeek
        case .bottom: r.origin.y = screen.frame.minY - r.height + dockPeek
        }
        return r
    }

    /// 完全可见位置（同一方向弹回）。
    private func fullFrame(for edge: DockEdge) -> NSRect {
        guard let screen = screenContaining() else { return frame }
        var r = frame
        switch edge {
        case .left: r.origin.x = screen.frame.minX
        case .right: r.origin.x = screen.frame.maxX - r.width
        case .bottom: r.origin.y = screen.frame.minY
        }
        return r
    }

    private func screenContaining() -> NSScreen? {
        NSScreen.screens.first { $0.frame.intersects(frame) } ?? NSScreen.main
    }

    /// 鼠标是否处于贴边热区（边缘附近 + 窗口纵向范围）。
    private func hotZoneContains(_ p: NSPoint) -> Bool {
        guard let edge = dockEdge, let screen = screenContaining() else { return false }
        let sf = screen.frame
        let pad: CGFloat = 60
        let inY = p.y >= frame.minY - 30 && p.y <= frame.maxY + 30
        let inX = p.x >= frame.minX - 30 && p.x <= frame.maxX + 30
        switch edge {
        case .left: return p.x <= sf.minX + pad && inY
        case .right: return p.x >= sf.maxX - pad && inY
        case .bottom: return p.y <= sf.minY + pad && inX
        }
    }

    /// 贴边期间：全局鼠标移动（含点击）检测热区 → 弹回；本地点击吞掉不传给页面。
    private func startMonitors() {
        stopMonitors()
        globalMonitor = NSEvent.addGlobalMonitorForEvents(
            matching: [.mouseMoved, .leftMouseDown, .leftMouseDragged]
        ) { [weak self] _ in
            guard let self, self.dockEdge != nil else { return }
            if self.hotZoneContains(NSEvent.mouseLocation) {
                DispatchQueue.main.async { self.undock() }
            }
        }
        clickMonitor = NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDown]) { [weak self] event in
            guard let self, self.dockEdge != nil else { return event }
            let screenLoc = self.convertPoint(toScreen: event.locationInWindow)
            if NSPointInRect(screenLoc, self.frame) {
                DispatchQueue.main.async { self.undock() }
                return nil // 吞掉，避免贴边时误开聊天
            }
            return event
        }
    }

    private func stopMonitors() {
        if let monitor = globalMonitor {
            NSEvent.removeMonitor(monitor)
            globalMonitor = nil
        }
        if let monitor = clickMonitor {
            NSEvent.removeMonitor(monitor)
            clickMonitor = nil
        }
    }

    /// 弹回后空闲计时：鼠标离开窗口一段时间且处于紧凑模式 → 重新贴边。
    private func startIdleTimer() {
        idleTimer?.invalidate()
        idleTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            guard let self else { return }
            let p = NSEvent.mouseLocation
            let inside = self.frame.insetBy(dx: -40, dy: -40).contains(p)
            if inside {
                self.lastMouseFar = nil
            } else {
                if self.lastMouseFar == nil {
                    self.lastMouseFar = Date()
                } else if Date().timeIntervalSince(self.lastMouseFar!) > self.reDockDelay,
                          self.dockEdge == nil, self.layoutCompact {
                    DispatchQueue.main.async { self.maybeDock() }
                }
            }
        }
    }

    // MARK: - 通用动画

    private func animate(to target: NSRect, duration: TimeInterval) {
        NSAnimationContext.runAnimationGroup { context in
            context.duration = duration
            context.timingFunction = CAMediaTimingFunction(name: .easeOut)
            context.allowsImplicitAnimation = true
            animator().setFrame(target, display: true)
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
