// swift-tools-version: 6.1

import PackageDescription

let package = Package(
  name: "EtyonScreenAwareness",
  platforms: [
    .macOS(.v14),
  ],
  products: [
    .executable(
      name: "EtyonScreenAwareness",
      targets: ["EtyonScreenAwareness"]
    ),
  ],
  dependencies: [
    .package(
      url: "https://github.com/jaywcjlove/PermissionFlow.git",
      from: "1.0.0"
    ),
  ],
  targets: [
    .executableTarget(
      name: "EtyonScreenAwareness",
      dependencies: [
        .product(name: "SystemSettingsKit", package: "PermissionFlow"),
      ],
      swiftSettings: [
        .enableUpcomingFeature("StrictConcurrency"),
      ]
    ),
    .testTarget(
      name: "EtyonScreenAwarenessTests",
      dependencies: ["EtyonScreenAwareness"]
    ),
  ]
)
