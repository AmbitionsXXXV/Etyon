import AppKit
import ScreenCaptureKit

private struct ScreenCaptureEventRecord: Codable {
  let accessibleText: String?
  let appBundleId: String?
  let appIconPath: String?
  let appName: String
  let capturedAt: String
  let errorCode: String?
  let id: String
  let imagePath: String?
  let kind: String
  let mediaType: String
  let selectedText: String?
  let warnings: [String]
  let windowId: UInt32?
  let windowTitle: String?
}

@MainActor
final class WindowCaptureService {
  var isCaptureAllowed: () -> Bool = { true }
  private let directoryURL: URL
  private var tasks: [UUID: Task<Void, Never>] = [:]
  private var deadlines: [UUID: Task<Void, Never>] = [:]

  init?(path: String?) {
    guard let path, !path.isEmpty else { return nil }
    directoryURL = URL(fileURLWithPath: path, isDirectory: true)
  }

  func cancel() {
    for task in tasks.values { task.cancel() }
    for deadline in deadlines.values { deadline.cancel() }
    tasks.removeAll()
    deadlines.removeAll()
  }

  func reportError(code: String) { persistError(application: .current, id: UUID(), code: code) }

  private func windows(processId: pid_t) -> [CaptureWindowCandidate] {
    let records = CGWindowListCopyWindowInfo(.optionOnScreenOnly, kCGNullWindowID)
      as? [[String: Any]] ?? []
    return records.compactMap { record in
      guard record[kCGWindowOwnerPID as String] as? pid_t == processId,
        record[kCGWindowLayer as String] as? Int == 0,
        let id = record[kCGWindowNumber as String] as? UInt32,
        let dictionary = record[kCGWindowBounds as String] as? [String: Any],
        let bounds = CGRect(dictionaryRepresentation: dictionary as CFDictionary),
        bounds.width > 0, bounds.height > 0
      else { return nil }
      return CaptureWindowCandidate(bounds: bounds, id: id, title: record[kCGWindowName as String] as? String)
    }
  }

  func capture(application: NSRunningApplication) {
    guard isCaptureAllowed() else { return }
    let id = UUID()
    guard tasks.count < 4 else { persistError(application: application, id: id, code: "capture-limit"); return }
    let capturedAt = ISO8601DateFormatter().string(from: Date())
    guard CapturePolicy.allows(bundleId: application.bundleIdentifier) else {
      persistError(application: application, id: id, code: "protected-surface")
      return
    }
    let hasAccessibility = AXIsProcessTrusted()
    let text = hasAccessibility ? AccessibilityCaptureReader.read(processId: application.processIdentifier) : nil
    guard text?.protectedContent != true else {
      persistError(application: application, id: id, code: "protected-surface")
      return
    }
    // Resolve identity synchronously while the source window still has focus.
    let target = CapturePolicy.selectWindow(
      candidates: windows(processId: application.processIdentifier),
      focusedBounds: text?.bounds, focusedTitle: text?.title
    )
    let screenRecording = CGPreflightScreenCaptureAccess()
    tasks[id] = Task { @MainActor [weak self] in
      guard let self else { return }
      defer { self.tasks.removeValue(forKey: id); self.deadlines.removeValue(forKey: id)?.cancel() }
      var image: CGImage?
      var warnings: [String] = []
      if screenRecording, let target {
        do {
          let content = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: true)
          guard !Task.isCancelled else { return }
          if !application.isTerminated, let window = content.windows.first(where: {
              $0.windowID == target.id && $0.owningApplication?.processID == application.processIdentifier
            })
          {
          let configuration = SCStreamConfiguration()
          let scale = min(2, 2048 / max(window.frame.width, window.frame.height))
          configuration.height = max(1, Int(window.frame.height * scale))
          configuration.width = max(1, Int(window.frame.width * scale))
          configuration.showsCursor = false
          image = try await SCScreenshotManager.captureImage(
            contentFilter: SCContentFilter(desktopIndependentWindow: window), configuration: configuration
          )
          } else { warnings.append("window-unavailable") }
        } catch {
          warnings.append("screenshot-unavailable")
        }
      } else {
        warnings.append(screenRecording ? "window-unavailable" : "screen-permission-required")
      }
      guard !Task.isCancelled, isCaptureAllowed() else { return }
      if text?.text == nil && text?.selectedText == nil {
        warnings.append(hasAccessibility ? "text-unavailable" : "accessibility-permission-required")
      }
      if text?.truncated == true { warnings.append("text-truncated") }
      guard image != nil || text?.text != nil || text?.selectedText != nil else {
        persistError(application: application, id: id, code: "capture-unavailable")
        return
      }
      do {
        try persist(application: application, id: id, image: image, text: text, target: target, warnings: warnings, capturedAt: capturedAt)
      } catch {
        persistError(application: application, id: id, code: "storage-failed")
      }
    }
    deadlines[id] = Task { @MainActor [weak self] in
      do { try await Task.sleep(for: .seconds(10)) } catch { return }
      guard let self, let task = self.tasks.removeValue(forKey: id) else { return }
      task.cancel()
      self.deadlines.removeValue(forKey: id)
      self.persistError(application: application, id: id, code: "capture-unavailable")
    }
  }

  private func write(_ record: ScreenCaptureEventRecord) throws {
    try FileManager.default.createDirectory(at: directoryURL, withIntermediateDirectories: true,
      attributes: [.posixPermissions: 0o700])
    let eventURL = directoryURL.appendingPathComponent("\(record.id).json")
    try JSONEncoder().encode(record).write(to: eventURL, options: .atomic)
    try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: eventURL.path)
  }

  private func persistError(application: NSRunningApplication, id: UUID, code: String) {
    try? write(ScreenCaptureEventRecord(
      accessibleText: nil, appBundleId: application.bundleIdentifier, appIconPath: nil,
      appName: CaptureTextPolicy.bounded(application.localizedName ?? "App", utf16Limit: 256), capturedAt: ISO8601DateFormatter().string(from: Date()),
      errorCode: code, id: id.uuidString.lowercased(), imagePath: nil, kind: "error", mediaType: "image/png",
      selectedText: nil, warnings: [], windowId: nil, windowTitle: nil
    ))
  }

  private func persist(application: NSRunningApplication, id: UUID, image: CGImage?,
    text: AccessibilityCapture?, target: CaptureWindowCandidate?, warnings: [String], capturedAt: String) throws
  {
    let fileManager = FileManager.default
    try fileManager.createDirectory(at: directoryURL, withIntermediateDirectories: true,
      attributes: [.posixPermissions: 0o700])
    let key = id.uuidString.lowercased()
    var imagePath: String?
    if let image, let data = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]) {
      let imageURL = directoryURL.appendingPathComponent("\(key).png")
      try data.write(to: imageURL, options: .atomic)
      try fileManager.setAttributes([.posixPermissions: 0o600], ofItemAtPath: imageURL.path)
      imagePath = imageURL.path
    }
    var iconPath: String?
    if let data = application.icon?.tiffRepresentation,
      let representation = NSBitmapImageRep(data: data),
      let png = representation.representation(using: .png, properties: [:])
    {
      let iconURL = directoryURL.appendingPathComponent("\(key)-icon.png")
      try png.write(to: iconURL, options: .atomic)
      try fileManager.setAttributes([.posixPermissions: 0o600], ofItemAtPath: iconURL.path)
      iconPath = iconURL.path
    }
    try write(ScreenCaptureEventRecord(
      accessibleText: text?.text, appBundleId: application.bundleIdentifier, appIconPath: iconPath,
      appName: CaptureTextPolicy.bounded(application.localizedName ?? application.bundleIdentifier ?? "App", utf16Limit: 256),
      capturedAt: capturedAt, errorCode: nil, id: key,
      imagePath: imagePath, kind: "ready", mediaType: "image/png", selectedText: text?.selectedText,
      warnings: warnings, windowId: target?.id, windowTitle: (text?.title ?? target?.title).map { CaptureTextPolicy.bounded($0, utf16Limit: 1000) }
    ))
  }
}
