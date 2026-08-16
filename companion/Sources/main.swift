import AppKit

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
// 无 Dock 图标：桌宠只活在托盘 + 悬浮窗
app.setActivationPolicy(.accessory)
app.run()
