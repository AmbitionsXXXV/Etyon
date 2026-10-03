import AppKit

public enum HelperCommandPolicy {
  public static func accepts(command: String, issuedAt: Double, targetInstanceId: String?, instanceId: String, startedAt: Double, now: Double) -> Bool {
    guard issuedAt.isFinite, now - issuedAt < 600_000, issuedAt - now < 1000 else { return false }
    if command == "terminate" { return issuedAt >= startedAt }
    return (command == "capture" || command == "onboard") && targetInstanceId == instanceId
  }
}

public enum CaptureTextPolicy {
  public static func bounded(_ text: String, utf16Limit: Int) -> String {
    var count = 0
    var output = ""
    for character in text {
      let value = String(character)
      if value.unicodeScalars.contains(where: { $0.value < 32 && $0.value != 9 && $0.value != 10 && $0.value != 13 }) { continue }
      let units = value.utf16.count
      guard count + units <= utf16Limit else { break }
      output.append(character)
      count += units
    }
    return output
  }
}
import ApplicationServices

struct CaptureWindowCandidate: Equatable {
  let bounds: CGRect
  let id: CGWindowID
  let title: String?
}

enum CapturePolicy {
  static let maxTextCharacters = 24_000
  static let maxTraversalNodes = 400
  static let maxTraversalDepth = 12
  static let traversalSeconds: TimeInterval = 0.3
  static let excludedBundleIds: Set<String> = [
    "com.1password.1password", "com.agilebits.onepassword7",
    "com.apple.SecurityAgent", "com.apple.loginwindow",
    "com.apple.systempreferences", "com.bitwarden.desktop", "org.keepassxc.keepassxc",
  ]

  static func allows(bundleId: String?) -> Bool {
    guard let bundleId else { return false }
    return !bundleId.hasPrefix("com.etcetera.etyon")
      && !excludedBundleIds.contains(bundleId)
  }

  static func selectWindow(
    candidates: [CaptureWindowCandidate], focusedBounds: CGRect?, focusedTitle: String?
  ) -> CaptureWindowCandidate? {
    if let focusedBounds {
      let matches = candidates.filter { candidate in
        abs(candidate.bounds.minX - focusedBounds.minX) < 3
          && abs(candidate.bounds.minY - focusedBounds.minY) < 3
          && abs(candidate.bounds.width - focusedBounds.width) < 3
          && abs(candidate.bounds.height - focusedBounds.height) < 3
      }
      if matches.count == 1 { return matches.first }
      if let focusedTitle, let match = matches.first(where: { $0.title == focusedTitle }) {
        return match
      }
      return nil
    }
    // CGWindowList is ordered front to back. Do not choose by window area.
    return candidates.first
  }
}

struct AccessibilityCapture {
  let bounds: CGRect?
  let protectedContent: Bool
  let selectedText: String?
  let text: String?
  let title: String?
  let truncated: Bool
}

@MainActor
enum AccessibilityCaptureReader {
  private static func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success else {
      return nil
    }
    return value
  }

  private static func elementAttribute(_ element: AXUIElement, _ name: String) -> AXUIElement? {
    guard let value = attribute(element, name), CFGetTypeID(value) == AXUIElementGetTypeID() else {
      return nil
    }
    return (value as! AXUIElement)
  }

  private static func isSecure(_ element: AXUIElement) -> Bool {
    let role = attribute(element, kAXRoleAttribute) as? String
    let subrole = attribute(element, kAXSubroleAttribute) as? String
    return role == "AXSecureTextField" || subrole == "AXSecureTextField"
      || subrole == "AXSecureTextEntryArea"
  }

  private static func bounds(_ element: AXUIElement) -> CGRect? {
    guard let position = attribute(element, kAXPositionAttribute),
      let size = attribute(element, kAXSizeAttribute),
      CFGetTypeID(position) == AXValueGetTypeID(), CFGetTypeID(size) == AXValueGetTypeID()
    else { return nil }
    var point = CGPoint.zero
    var dimensions = CGSize.zero
    guard AXValueGetValue(position as! AXValue, .cgPoint, &point),
      AXValueGetValue(size as! AXValue, .cgSize, &dimensions)
    else { return nil }
    return CGRect(origin: point, size: dimensions)
  }

  static func read(processId: pid_t) -> AccessibilityCapture {
    let application = AXUIElementCreateApplication(processId)
    AXUIElementSetMessagingTimeout(application, 0.05)
    let focused = elementAttribute(application, kAXFocusedUIElementAttribute)
    let window = elementAttribute(application, kAXFocusedWindowAttribute)
    let protectedContent = focused.map(isSecure) ?? false
    let selected = protectedContent ? nil : focused.flatMap {
      attribute($0, kAXSelectedTextAttribute) as? String
    }
    let deadline = Date().addingTimeInterval(CapturePolicy.traversalSeconds)
    var queue: [(AXUIElement, Int)] = window.map { [($0, 0)] } ?? []
    var offset = 0
    var characterCount = 0
    var strings: [String] = []
    var seenStrings = Set<String>()
    var seenElements = Set<CFHashCode>()
    while offset < queue.count, offset < CapturePolicy.maxTraversalNodes,
      characterCount < CapturePolicy.maxTextCharacters, Date() < deadline
    {
      let (element, depth) = queue[offset]
      offset += 1
      guard seenElements.insert(CFHash(element)).inserted, !isSecure(element) else { continue }
      for name in [kAXTitleAttribute, kAXDescriptionAttribute, kAXValueAttribute] {
        guard let raw = attribute(element, name) as? String else { continue }
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, seenStrings.insert(text).inserted else { continue }
        let remaining = max(0, CapturePolicy.maxTextCharacters - characterCount)
        let bounded = CaptureTextPolicy.bounded(text, utf16Limit: remaining)
        guard !bounded.isEmpty else { continue }
        strings.append(bounded)
        characterCount += bounded.utf16.count + 1
      }
      if depth < CapturePolicy.maxTraversalDepth,
        let children = attribute(element, kAXChildrenAttribute) as? [AXUIElement]
      {
        let remaining = max(0, CapturePolicy.maxTraversalNodes - queue.count)
        queue.append(contentsOf: children.prefix(remaining).map { ($0, depth + 1) })
      }
    }
    return AccessibilityCapture(
      bounds: window.flatMap(bounds), protectedContent: protectedContent,
      selectedText: selected.map { CaptureTextPolicy.bounded($0, utf16Limit: CapturePolicy.maxTextCharacters) },
      text: strings.isEmpty ? nil : strings.joined(separator: "\n"),
      title: window.flatMap { attribute($0, kAXTitleAttribute) as? String },
      truncated: offset < queue.count || characterCount >= CapturePolicy.maxTextCharacters || (selected?.utf16.count ?? 0) > CapturePolicy.maxTextCharacters
    )
  }
}
