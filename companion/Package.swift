// swift-tools-version: 5.10
import PackageDescription

let package = Package(
    name: "DeepSeekPet",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(
            name: "DeepSeekPet",
            path: "Sources"
        )
    ]
)
