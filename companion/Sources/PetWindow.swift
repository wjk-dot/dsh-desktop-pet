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
    private var autoDockEnabled = true

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

    /// LSUIElement + borderless NSWindow 组合下，WebKit 有时收不到 AppKit 的
    /// Command 编辑命令。复制等命令仍走 WebKit / responder chain；粘贴文本则
    /// 从系统剪贴板确定性写入当前 HTML 输入框，避免菜单链路丢失 Cmd+V。
    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        guard event.modifierFlags.intersection(.deviceIndependentFlagsMask).contains(.command),
              let key = event.charactersIgnoringModifiers?.lowercased() else {
            return super.performKeyEquivalent(with: event)
        }

        switch key {
        case "v":
            if pastePlainTextIntoInput() {
                return true
            }
            if webView.performKeyEquivalent(with: event) {
                return true
            }
            return NSApp.sendAction(#selector(NSText.paste(_:)), to: nil, from: self)
        case "x":
            if webView.performKeyEquivalent(with: event) {
                return true
            }
            return NSApp.sendAction(#selector(NSText.cut(_:)), to: nil, from: self)
        case "c":
            if webView.performKeyEquivalent(with: event) {
                return true
            }
            return NSApp.sendAction(#selector(NSText.copy(_:)), to: nil, from: self)
        case "a":
            if webView.performKeyEquivalent(with: event) {
                return true
            }
            return NSApp.sendAction(#selector(NSText.selectAll(_:)), to: nil, from: self)
        default:
            return super.performKeyEquivalent(with: event)
        }
    }

    private func pastePlainTextIntoInput() -> Bool {
        guard let text = NSPasteboard.general.string(forType: .string), !text.isEmpty,
              let data = try? JSONSerialization.data(withJSONObject: text, options: [.fragmentsAllowed]),
              let json = String(data: data, encoding: .utf8) else {
            return false
        }
        webView.eval("""
        (function () {
          var input = document.getElementById('inputText');
          if (!input || input.closest('[hidden]')) return;
          input.focus();
          var start = input.selectionStart == null ? input.value.length : input.selectionStart;
          var end = input.selectionEnd == null ? input.value.length : input.selectionEnd;
          input.setRangeText(__PET_CLIPBOARD_TEXT__, start, end, 'end');
          input.dispatchEvent(new Event('input', { bubbles: true }));
        })();
        """.replacingOccurrences(of: "__PET_CLIPBOARD_TEXT__", with: json))
        return true
    }

    // MARK: - 页面状态推送

    func notifyConnection(_ online: Bool) {
        webView.eval(online
            ? "window.petBridge && window.petBridge.renderOnline()"
            : "window.petBridge && window.petBridge.renderOffline()")
    }

    func notifyMemoryCleared() {
        webView.eval("window.petBridge && window.petBridge.clearTranscript()")
    }

    /// 桌宠开关（由 host 状态栏入口控制）：关闭隐藏窗口，开启恢复显示。
    func setPetEnabled(_ enabled: Bool) {
        if enabled {
            clampToVisible()
            if !isVisible { orderFrontRegardless() }
        } else if isVisible {
            orderOut(nil)
        }
    }

    /// 把窗口拉回可见区域（布局/拖动/恢复位置都可能把窗口推出屏幕，
    /// 导致"只看到气泡看不到鲸鱼"这类问题）。贴边状态是刻意部分离屏，跳过。
    func clampToVisible() {
        guard dockEdge == nil else { return }
        let r = clampedToVisible(frame, on: screenContaining())
        if r != frame {
            setFrame(r, display: true)
        }
    }

    /// 将指定 frame 钳到可见屏幕。必须用于动画的目标 frame，不能等动画开始后再修。
    private func clampedToVisible(_ rect: NSRect, on screen: NSScreen?) -> NSRect {
        guard let screen else { return rect }
        let vf = screen.visibleFrame
        var r = rect
        if r.width <= vf.width && r.height <= vf.height {
            r.origin.x = min(max(r.minX, vf.minX), vf.maxX - r.width)
            r.origin.y = min(max(r.minY, vf.minY), vf.maxY - r.height)
        } else {
            r.origin.x = max(r.minX, vf.minX)
            r.origin.y = min(max(r.minY, vf.minY), vf.maxY - r.height)
        }
        return r
    }

    /// 当前窗口只剩一条边时也要拉回来。`intersects` 单独使用会把这种坏位置
    /// 当成有效位置，尤其在多屏和贴边调试状态下很容易复现。
    private func screenForVisibleWindow(_ rect: NSRect) -> NSScreen? {
        let candidates = NSScreen.screens.compactMap { screen -> (NSScreen, CGFloat)? in
            let area = screen.visibleFrame.intersection(rect)
            guard !area.isNull, area.width > 0, area.height > 0 else { return nil }
            return (screen, area.width * area.height)
        }
        return candidates.max(by: { $0.1 < $1.1 })?.0
    }

    // MARK: - 动态窗口尺寸（JS 布局消息驱动）

    /// 图标尺寸持久化键。
    private static let iconSizeKey = "petIconSize"

    /// 按 JS 布局消息调整窗口。
    ///
    /// 气泡、输入框和桌宠共用一个 WKWebView。紧凑态若把原生窗口缩到图标尺寸，
    /// 历史会话恢复时网页可能先画出气泡而窗口仍是 168px，导致页面被裁成只露一角。
    /// 因此原生层始终保留完整聊天画布；网页空白区域透明，不影响桌宠外观。
    func applyLayout(mode: String, width: CGFloat, height: CGFloat, iconSize: CGFloat) {
        guard width > 40, height > 40 else { return }
        layoutCompact = (mode == "compact")
        if iconSize > 0 {
            UserDefaults.standard.set(Double(iconSize), forKey: PetWindow.iconSizeKey)
        }
        let canvasWidth = PetWindow.windowSize.width
        let canvasHeight = max(PetWindow.windowSize.height, iconSize + 406)
        var target = NSRect(
            x: frame.midX - canvasWidth / 2,
            y: frame.minY,
            width: canvasWidth,
            height: canvasHeight
        )
        // 尺寸变化后若处于贴边状态，重新贴边保持"尾巴"大小
        if let edge = dockEdge, let screen = screenContaining() {
            var r = target
            switch edge {
            case .left: r.origin.x = screen.frame.minX - r.width + dockPeek
            case .right: r.origin.x = screen.frame.maxX - dockPeek
            case .bottom: r.origin.y = screen.frame.minY - r.height + dockPeek
            }
            target = r
        } else {
            target = clampedToVisible(target, on: screenContaining())
        }
        guard target != frame else { return }
        animate(to: target, duration: 0.18)
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
        guard autoDockEnabled, layoutCompact, dockEdge == nil,
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

    /// 由网页偏好桥更新；关掉自动贴边时，已贴边的窗口立即回到可见区。
    func applyPreferences(autoDock: Bool) {
        autoDockEnabled = autoDock
        if !autoDock, dockEdge != nil {
            undock()
        }
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
        screenForVisibleWindow(frame)
            ?? NSScreen.screens.first { $0.frame.intersects(frame) }
            ?? NSScreen.main
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
            // 保存的位置必须落在某个屏幕的可见区内，否则回默认角落
            // （历史坏位置会把窗口推到屏幕外，只露出气泡一角）。
            if let screen = NSScreen.screens.first(where: {
                let area = $0.visibleFrame.intersection(rect)
                return !area.isNull && area.width >= min(rect.width, 160) && area.height >= min(rect.height, 160)
            }) {
                let vf = screen.visibleFrame
                var p = rect.origin
                p.x = min(max(p.x, vf.minX), vf.maxX - rect.width)
                p.y = min(max(p.y, vf.minY), vf.maxY - rect.height)
                return p
            }
            // 不在任何屏幕内 → 落到默认角落
        }
        // 默认：主屏右下角
        if let screen = NSScreen.main {
            let vf = screen.visibleFrame
            return NSPoint(x: vf.maxX - windowSize.width - 24, y: vf.minY + 20)
        }
        return NSPoint(x: 100, y: 100)
    }
}
