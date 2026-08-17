import AppKit
import CoreGraphics

/// Explicit, one-shot user-selected display capture. Nothing is recorded or
/// captured until the user presses the camera button in the pet input bar.
enum ScreenCapture {
    private static let targetWidth: CGFloat = 1600
    private static let maxBytes = 5 * 1024 * 1024

    /// Opens macOS's standard interactive screenshot selector. The result is
    /// returned only after the user confirms a selected window/region.
    static func captureInteractiveJPEG(completion: @escaping (Result<Data, Error>) -> Void) {
        let temporaryURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("deepseek-pet-\(UUID().uuidString).jpg")
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
        // -i uses the familiar macOS selection UI; -t jpg keeps the handoff
        // predictable for the vision endpoint.
        process.arguments = ["-i", "-t", "jpg", temporaryURL.path]

        DispatchQueue.global(qos: .userInitiated).async {
            do {
                try process.run()
                process.waitUntilExit()
                defer { try? FileManager.default.removeItem(at: temporaryURL) }
                guard process.terminationStatus == 0 else {
                    completion(.failure(CaptureError.cancelled))
                    return
                }
                let source = try Data(contentsOf: temporaryURL)
                guard !source.isEmpty else {
                    completion(.failure(CaptureError.cancelled))
                    return
                }
                completion(.success(try encodeJPEG(from: source)))
            } catch {
                completion(.failure(error))
            }
        }
    }

    private static func encodeJPEG(from data: Data) throws -> Data {
        guard let image = NSImage(data: data), image.size.width > 0, image.size.height > 0 else {
            throw CaptureError.captureFailed
        }
        let scale = min(1, targetWidth / max(1, image.size.width))
        let size = NSSize(width: max(1, image.size.width * scale), height: max(1, image.size.height * scale))
        guard let bitmap = NSBitmapImageRep(
            bitmapDataPlanes: nil,
            pixelsWide: Int(size.width), pixelsHigh: Int(size.height),
            bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
            isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0
        ) else { throw CaptureError.encodeFailed }
        bitmap.size = size
        NSGraphicsContext.saveGraphicsState()
        guard let context = NSGraphicsContext(bitmapImageRep: bitmap) else {
            NSGraphicsContext.restoreGraphicsState()
            throw CaptureError.encodeFailed
        }
        NSGraphicsContext.current = context
        image.draw(in: NSRect(origin: .zero, size: size), from: NSRect(origin: .zero, size: image.size), operation: .copy, fraction: 1)
        NSGraphicsContext.restoreGraphicsState()

        for quality in stride(from: 0.82, through: 0.42, by: -0.10) {
            if let data = bitmap.representation(using: .jpeg, properties: [.compressionFactor: quality]), data.count <= maxBytes {
                return data
            }
        }
        throw CaptureError.imageTooLarge
    }

    enum CaptureError: LocalizedError {
        case captureFailed
        case encodeFailed
        case imageTooLarge
        case cancelled

        var errorDescription: String? {
            switch self {
            case .captureFailed: return "无法读取所选截图"
            case .encodeFailed: return "截图编码失败"
            case .imageTooLarge: return "截图压缩后仍超过大小限制"
            case .cancelled: return "已取消截图"
            }
        }
    }
}
