import AppKit
import ApplicationServices
import CoreGraphics
import SwiftUI
import SystemSettingsKit

private enum PermissionState: String, Codable {
  case granted
  case notGranted = "not-granted"
}

private struct PermissionSnapshot: Codable, Equatable {
  let accessibility: PermissionState
  let screenRecording: PermissionState

  var allGranted: Bool {
    accessibility == .granted && screenRecording == .granted
  }

  static func current() -> PermissionSnapshot {
    PermissionSnapshot(
      accessibility: AXIsProcessTrusted() ? .granted : .notGranted,
      screenRecording: CGPreflightScreenCaptureAccess() ? .granted : .notGranted
    )
  }
}

private struct PermissionStatusRecord: Codable {
  let accessibility: PermissionState
  let screenRecording: PermissionState
  let updatedAt: String
}

@MainActor
private final class PermissionStatusReporter {
  private let fileURL: URL
  private var timer: Timer?

  init?(path: String?) {
    guard let path, !path.isEmpty else {
      return nil
    }

    fileURL = URL(fileURLWithPath: path)
  }

  func start() {
    writeCurrentStatus()
    timer?.invalidate()
    timer = Timer.scheduledTimer(withTimeInterval: 0.35, repeats: true) {
      [weak self] _ in
      Task { @MainActor in
        self?.writeCurrentStatus()
      }
    }
  }

  func stop() {
    timer?.invalidate()
    timer = nil
  }

  private func writeCurrentStatus() {
    let snapshot = PermissionSnapshot.current()
    let record = PermissionStatusRecord(
      accessibility: snapshot.accessibility,
      screenRecording: snapshot.screenRecording,
      updatedAt: ISO8601DateFormatter().string(from: Date())
    )
    guard let data = try? JSONEncoder().encode(record) else {
      return
    }

    try? FileManager.default.createDirectory(
      at: fileURL.deletingLastPathComponent(),
      withIntermediateDirectories: true
    )
    try? data.write(to: fileURL, options: .atomic)
  }
}

@MainActor
private final class HelperControlMonitor {
  private let fileURL: URL
  private var timer: Timer?

  init?(path: String?) {
    guard let path, !path.isEmpty else {
      return nil
    }

    fileURL = URL(fileURLWithPath: path)
  }

  func start() {
    timer?.invalidate()
    timer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) {
      [weak self] _ in
      Task { @MainActor in
        self?.readCommand()
      }
    }
  }

  func stop() {
    timer?.invalidate()
    timer = nil
  }

  private func readCommand() {
    guard
      let command = try? String(contentsOf: fileURL, encoding: .utf8)
        .trimmingCharacters(in: .whitespacesAndNewlines),
      command == "terminate"
    else {
      return
    }

    try? FileManager.default.removeItem(at: fileURL)
    NSApp.terminate(nil)
  }
}

private enum PermissionKind {
  case accessibility
  case screenRecording
}

private enum AppLanguage: String {
  case english = "en"
  case japanese = "ja"
  case simplifiedChinese = "zh"

  static func resolve(arguments: [String]) -> AppLanguage {
    if let localeIndex = arguments.firstIndex(of: "--locale"),
      arguments.indices.contains(localeIndex + 1)
    {
      return from(identifier: arguments[localeIndex + 1])
    }

    return from(identifier: Locale.current.identifier)
  }

  private static func from(identifier: String) -> AppLanguage {
    let normalized = identifier.lowercased()

    if normalized.hasPrefix("zh") {
      return .simplifiedChinese
    }

    if normalized.hasPrefix("ja") {
      return .japanese
    }

    return .english
  }
}

private struct AppCopy {
  let accessibilityDescription: String
  let accessibilityTitle: String
  let allSetDescription: String
  let allSetTitle: String
  let backButton: String
  let completedLabel: String
  let continueButton: String
  let dragInstruction: String
  let dragLabel: String
  let footer: String
  let headline: String
  let laterButton: String
  let notGranted: String
  let permissionsTitle: String
  let privacyDescription: String
  let readyButton: String
  let restartButton: String
  let screenCompanionTitle: String
  let screenDescription: String
  let screenTitle: String
  let title: String
  let waitingLabel: String
  let accessibilityCompanionTitle: String

  static func localized(_ language: AppLanguage) -> AppCopy {
    let usesDeviceControlName =
      ProcessInfo.processInfo.operatingSystemVersion.majorVersion >= 27

    return switch language {
    case .simplifiedChinese:
      AppCopy(
        accessibilityDescription: "读取当前窗口提供的可访问文本",
        accessibilityTitle: usesDeviceControlName ? "设备控制和数据访问" : "辅助功能",
        allSetDescription: "回到想分享的窗口，再次同时按下左右 Command。",
        allSetTitle: "Screen Awareness 已准备好",
        backButton: "返回",
        completedLabel: "已完成",
        continueButton: "设置权限",
        dragInstruction: "拖动应用图标到列表，然后打开开关",
        dragLabel: "拖拽",
        footer: "仅在你主动按下时捕获；内容会在发送前预览。Etyon 不录制音频。",
        headline: "按下左右 Command，分享当前窗口",
        laterButton: "稍后",
        notGranted: "未授权",
        permissionsTitle: "权限检查",
        privacyDescription: "分享当前窗口",
        readyButton: "完成",
        restartButton: "重启并检查",
        screenCompanionTitle: "允许 Etyon 获取窗口画面",
        screenDescription: "获取当前窗口画面，不会录制音频",
        screenTitle: "屏幕与系统音频录制",
        title: "按下左右 Command",
        waitingLabel: "等待授权…",
        accessibilityCompanionTitle: usesDeviceControlName
          ? "将 Etyon 加入设备控制和数据访问"
          : "将 Etyon 加入辅助功能"
      )
    case .japanese:
      AppCopy(
        accessibilityDescription: "現在のウインドウが提供するアクセシブルなテキストを読み取ります",
        accessibilityTitle: usesDeviceControlName
          ? "デバイス制御とデータアクセス"
          : "アクセシビリティ",
        allSetDescription: "共有したいウインドウに戻り、左右の Command キーをもう一度押してください。",
        allSetTitle: "Screen Awareness の準備ができました",
        backButton: "戻る",
        completedLabel: "完了",
        continueButton: "権限を設定",
        dragInstruction: "アプリアイコンをリストへドラッグして、スイッチをオンにします",
        dragLabel: "ドラッグ",
        footer: "自分でキーを押した時だけ取得します。送信前に内容を確認できます。音声は録音しません。",
        headline: "左右の Command を押して現在のウインドウを共有",
        laterButton: "後で",
        notGranted: "未許可",
        permissionsTitle: "権限の確認",
        privacyDescription: "現在のウインドウを共有",
        readyButton: "完了",
        restartButton: "再起動して確認",
        screenCompanionTitle: "Etyon に画面の取得を許可",
        screenDescription: "現在のウインドウ画像を取得します。音声は録音しません",
        screenTitle: "画面とシステムオーディオの収録",
        title: "左右の Command を押す",
        waitingLabel: "許可を待っています…",
        accessibilityCompanionTitle: usesDeviceControlName
          ? "Etyon をデバイス制御とデータアクセスに追加"
          : "Etyon をアクセシビリティに追加"
      )
    case .english:
      AppCopy(
        accessibilityDescription: "Read accessible text exposed by the current window",
        accessibilityTitle: usesDeviceControlName
          ? "Device Control and Data Access"
          : "Accessibility",
        allSetDescription:
          "Return to the window you want to share, then press both Command keys again.",
        allSetTitle: "Screen Awareness is ready",
        backButton: "Back",
        completedLabel: "complete",
        continueButton: "Set permissions",
        dragInstruction: "Drag the app into the list, then turn on the switch",
        dragLabel: "Drag",
        footer:
          "Capture happens only when you press the keys. You can preview it before sending. Etyon does not record audio.",
        headline: "Press both Command keys to share the current window",
        laterButton: "Later",
        notGranted: "Not allowed",
        permissionsTitle: "Permission check",
        privacyDescription: "Share the current window",
        readyButton: "Done",
        restartButton: "Restart and check",
        screenCompanionTitle: "Allow Etyon to capture the window",
        screenDescription: "Capture the current window image without recording audio",
        screenTitle: "Screen & System Audio Recording",
        title: "Press both Command keys",
        waitingLabel: "Waiting for permission…",
        accessibilityCompanionTitle: usesDeviceControlName
          ? "Add Etyon to Device Control and Data Access"
          : "Add Etyon to Accessibility"
      )
    }
  }
}

@MainActor
private final class PermissionModel: ObservableObject {
  @Published private(set) var snapshot = PermissionSnapshot.current()

  let copy: AppCopy
  var onPermissionRequested: ((PermissionKind) -> Void)?
  var onPermissionsCompleted: (() -> Void)?
  private var activePermission: PermissionKind?
  private var refreshTimer: Timer?

  init(language: AppLanguage) {
    copy = .localized(language)
  }

  var completedCount: Int {
    [snapshot.accessibility, snapshot.screenRecording]
      .filter { $0 == .granted }
      .count
  }

  func beginMonitoring() {
    refresh()
    refreshTimer?.invalidate()
    refreshTimer = Timer.scheduledTimer(withTimeInterval: 0.35, repeats: true) { [weak self] _ in
      Task { @MainActor in
        self?.refresh()
      }
    }
  }

  func requestNextPermission() {
    refresh()

    if snapshot.accessibility != .granted {
      request(.accessibility)
      return
    }

    if snapshot.screenRecording != .granted {
      request(.screenRecording)
    }
  }

  func refresh() {
    let nextSnapshot = PermissionSnapshot.current()

    guard nextSnapshot != snapshot else {
      return
    }

    let permissionsWereComplete = snapshot.allGranted
    let previousSnapshot = snapshot
    snapshot = nextSnapshot

    if snapshot.allGranted {
      activePermission = nil

      if !permissionsWereComplete {
        onPermissionsCompleted?()
      }
      return
    }

    if activePermission == .accessibility,
      previousSnapshot.accessibility != .granted,
      snapshot.accessibility == .granted
    {
      activePermission = nil
      Task { @MainActor [weak self] in
        try? await Task.sleep(for: .milliseconds(350))
        self?.requestNextPermission()
      }
    }
  }

  private func request(_ permission: PermissionKind) {
    activePermission = permission
    onPermissionRequested?(permission)

    switch permission {
    case .accessibility:
      _ = AXIsProcessTrustedWithOptions(
        [
          "AXTrustedCheckOptionPrompt": true
        ] as CFDictionary)
      SystemSettings.open(.privacy(anchor: .privacyAccessibility))
    case .screenRecording:
      _ = CGRequestScreenCaptureAccess()
      SystemSettings.open(.privacy(anchor: .privacyScreenCapture))
    }
  }
}

private struct CommandKeycap: View {
  var body: some View {
    RoundedRectangle(cornerRadius: 18, style: .continuous)
      .fill(Color(nsColor: .controlBackgroundColor))
      .overlay {
        RoundedRectangle(cornerRadius: 18, style: .continuous)
          .stroke(Color.primary.opacity(0.13), lineWidth: 1)
      }
      .shadow(color: .black.opacity(0.07), radius: 9, y: 4)
      .frame(width: 88, height: 74)
      .overlay {
        Image(systemName: "command")
          .font(.system(size: 30, weight: .medium))
          .foregroundStyle(Color.primary.opacity(0.72))
      }
  }
}

private struct BrandIcon: View {
  @Environment(\.colorScheme) private var colorScheme

  let size: CGFloat

  var body: some View {
    if let image {
      Image(nsImage: image)
        .resizable()
        .scaledToFit()
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
  }

  private var image: NSImage? {
    let name = colorScheme == .dark ? "icon-dark" : "icon-light"

    guard let path = Bundle.main.path(forResource: name, ofType: "png") else {
      return NSApplication.shared.applicationIconImage
    }

    return NSImage(contentsOfFile: path)
  }
}

private struct GestureGuide: View {
  let copy: AppCopy

  var body: some View {
    VStack(spacing: 20) {
      BrandIcon(size: 56)

      Text(copy.headline)
        .font(.system(size: 25, weight: .semibold))
        .multilineTextAlignment(.center)
        .lineLimit(2)

      HStack(spacing: 16) {
        CommandKeycap()
        Capsule()
          .fill(Color.primary.opacity(0.12))
          .frame(width: 84, height: 2)
          .overlay {
            Circle()
              .fill(Color.primary.opacity(0.38))
              .frame(width: 12, height: 12)
          }
        CommandKeycap()
      }
      .accessibilityElement(children: .ignore)
      .accessibilityLabel(copy.title)
    }
    .frame(maxWidth: .infinity)
  }
}

private struct PermissionRow: View {
  let description: String
  let isGranted: Bool
  let systemImage: String
  let title: String
  let copy: AppCopy

  var body: some View {
    HStack(spacing: 14) {
      Image(systemName: systemImage)
        .font(.system(size: 18, weight: .medium))
        .frame(width: 34, height: 34)
        .background(Color.primary.opacity(0.055), in: RoundedRectangle(cornerRadius: 9))

      VStack(alignment: .leading, spacing: 3) {
        Text(title)
          .font(.system(size: 14, weight: .semibold))
        Text(description)
          .font(.system(size: 12))
          .foregroundStyle(.secondary)
      }

      Spacer(minLength: 12)

      Text(isGranted ? copy.completedLabel : copy.notGranted)
        .font(.system(size: 11, weight: .medium))
        .foregroundStyle(isGranted ? Color.green : Color.secondary)
        .padding(.horizontal, 9)
        .padding(.vertical, 5)
        .background(
          (isGranted ? Color.green : Color.secondary).opacity(0.09),
          in: Capsule()
        )
    }
    .padding(.horizontal, 16)
    .padding(.vertical, 15)
  }
}

private struct PermissionChecklist: View {
  @ObservedObject var model: PermissionModel

  var body: some View {
    VStack(alignment: .leading, spacing: 18) {
      HStack(alignment: .firstTextBaseline) {
        Text(model.copy.permissionsTitle)
          .font(.system(size: 17, weight: .semibold))
        Spacer()
        Text("\(model.completedCount) / 2 \(model.copy.completedLabel)")
          .font(.system(size: 12, weight: .medium))
          .foregroundStyle(.secondary)
      }

      VStack(spacing: 0) {
        PermissionRow(
          description: model.copy.screenDescription,
          isGranted: model.snapshot.screenRecording == .granted,
          systemImage: "rectangle.on.rectangle",
          title: model.copy.screenTitle,
          copy: model.copy
        )
        Divider()
          .padding(.leading, 64)
        PermissionRow(
          description: model.copy.accessibilityDescription,
          isGranted: model.snapshot.accessibility == .granted,
          systemImage: "accessibility",
          title: model.copy.accessibilityTitle,
          copy: model.copy
        )
      }
      .background(Color(nsColor: .controlBackgroundColor).opacity(0.62))
      .clipShape(RoundedRectangle(cornerRadius: 17, style: .continuous))
      .overlay {
        RoundedRectangle(cornerRadius: 17, style: .continuous)
          .stroke(Color.primary.opacity(0.1), lineWidth: 1)
      }
    }
  }
}

private struct PermissionOnboardingView: View {
  @ObservedObject var model: PermissionModel
  let onClose: () -> Void

  var body: some View {
    VStack(spacing: 0) {
      if model.snapshot.allGranted {
        VStack(spacing: 24) {
          BrandIcon(size: 78)
          Text(model.copy.allSetTitle)
            .font(.system(size: 27, weight: .semibold))
          Text(model.copy.allSetDescription)
            .font(.system(size: 15))
            .foregroundStyle(.secondary)
            .multilineTextAlignment(.center)
            .frame(maxWidth: 460)
          HStack(spacing: 14) {
            CommandKeycap()
            CommandKeycap()
          }
          Button(model.copy.readyButton, action: onClose)
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(44)
      } else {
        VStack(spacing: 24) {
          GestureGuide(copy: model.copy)

          PermissionChecklist(model: model)

          Label(model.copy.footer, systemImage: "lock.shield")
            .font(.system(size: 11.5))
            .foregroundStyle(.secondary)
            .lineLimit(2)
            .frame(maxWidth: .infinity, alignment: .leading)

          Divider()

          HStack(spacing: 12) {
            Button(model.copy.laterButton, action: onClose)
              .buttonStyle(.bordered)
              .controlSize(.large)
            Spacer()
            Button(model.copy.continueButton) {
              model.requestNextPermission()
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .tint(Color(nsColor: .labelColor))
            .keyboardShortcut(.defaultAction)
          }
        }
        .padding(38)
      }
    }
    .frame(width: 620, height: 720)
    .background(.ultraThinMaterial)
    .onAppear {
      model.beginMonitoring()
    }
  }
}

private struct CompanionPanelView: View {
  @ObservedObject var model: PermissionModel
  let onBack: () -> Void
  let onDragStateChange: (Bool) -> Void
  let onRestart: () -> Void
  let permission: PermissionKind

  private var companionTitle: String {
    switch permission {
    case .accessibility:
      model.copy.accessibilityCompanionTitle
    case .screenRecording:
      model.copy.screenCompanionTitle
    }
  }

  private var currentTitle: String {
    switch permission {
    case .accessibility:
      model.copy.accessibilityTitle
    case .screenRecording:
      model.copy.screenTitle
    }
  }

  private var nextTitle: String? {
    permission == .accessibility ? model.copy.screenTitle : nil
  }

  var body: some View {
    VStack(spacing: 18) {
      HStack(alignment: .top, spacing: 12) {
        BrandIcon(size: 42)
        VStack(alignment: .leading, spacing: 4) {
          Text(companionTitle)
            .font(.system(size: 16, weight: .semibold))
          Text(model.copy.dragInstruction)
            .font(.system(size: 12))
            .foregroundStyle(.secondary)
        }
        Spacer(minLength: 8)
      }

      AppBundleDragView(
        dragLabel: model.copy.dragLabel,
        onDragStateChange: onDragStateChange,
        url: Bundle.main.bundleURL
      )
      .frame(height: 126)

      VStack(spacing: 10) {
        HStack {
          Text(permission == .accessibility ? "1 / 2" : "2 / 2")
            .font(.system(size: 13, weight: .semibold))
          Spacer()
          if let nextTitle {
            Text(nextTitle)
              .font(.system(size: 10.5))
              .foregroundStyle(.secondary)
              .lineLimit(1)
          }
        }

        Divider()

        HStack(spacing: 10) {
          Image(
            systemName: permission == .accessibility
              ? "accessibility"
              : "rectangle.on.rectangle"
          )
          Text(currentTitle)
            .font(.system(size: 12.5, weight: .medium))
          Spacer()
          if permission == .screenRecording {
            Button(model.copy.restartButton, action: onRestart)
              .buttonStyle(.borderedProminent)
              .controlSize(.small)
          } else {
            Text(model.copy.waitingLabel)
              .font(.system(size: 11))
              .foregroundStyle(.secondary)
            ProgressView()
              .controlSize(.small)
          }
        }
      }

      Button(action: onBack) {
        Label(model.copy.backButton, systemImage: "chevron.left")
      }
      .buttonStyle(.plain)
      .font(.system(size: 11.5))
      .foregroundStyle(.secondary)
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .padding(22)
    .frame(width: 450, height: 344)
    .background(.regularMaterial)
    .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
    .overlay {
      RoundedRectangle(cornerRadius: 22, style: .continuous)
        .stroke(Color.primary.opacity(0.12), lineWidth: 1)
    }
  }
}

@MainActor
private final class CompanionPanelController {
  private let model: PermissionModel
  private let onBack: () -> Void
  private let onRestart: () -> Void
  private let panel: NSPanel
  private var trackingTimer: Timer?

  init(
    appearance: NSAppearance.Name?,
    model: PermissionModel,
    onBack: @escaping () -> Void,
    onRestart: @escaping () -> Void
  ) {
    self.model = model
    self.onBack = onBack
    self.onRestart = onRestart
    panel = NSPanel(
      contentRect: NSRect(x: 0, y: 0, width: 450, height: 344),
      styleMask: [.borderless, .nonactivatingPanel],
      backing: .buffered,
      defer: false
    )
    panel.backgroundColor = .clear
    if let appearance {
      panel.appearance = NSAppearance(named: appearance)
    }
    panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
    panel.hasShadow = true
    panel.isFloatingPanel = true
    panel.isMovableByWindowBackground = true
    panel.isOpaque = false
    panel.level = .floating
  }

  func hide() {
    trackingTimer?.invalidate()
    trackingTimer = nil
    setDraggingPassthrough(false)
    panel.orderOut(nil)
  }

  func show(permission: PermissionKind) {
    panel.contentViewController = NSHostingController(
      rootView: CompanionPanelView(
        model: model,
        onBack: onBack,
        onDragStateChange: { [weak self] isDragging in
          self?.setDraggingPassthrough(isDragging)
        },
        onRestart: onRestart,
        permission: permission
      )
    )
    setDraggingPassthrough(false)
    positionPanel()
    panel.orderFrontRegardless()
    trackingTimer?.invalidate()
    trackingTimer = Timer.scheduledTimer(withTimeInterval: 0.15, repeats: true) {
      [weak self] _ in
      Task { @MainActor in
        self?.positionPanel()
      }
    }
  }

  private func setDraggingPassthrough(_ isDragging: Bool) {
    panel.ignoresMouseEvents = isDragging
  }

  private func positionPanel() {
    guard let settingsFrame = systemSettingsFrame() else {
      guard let screen = NSScreen.main else {
        return
      }

      panel.setFrameOrigin(
        NSPoint(
          x: screen.visibleFrame.maxX - panel.frame.width - 18,
          y: screen.visibleFrame.minY + 18
        )
      )
      return
    }

    let screen =
      NSScreen.screens.first(where: {
        $0.visibleFrame.intersects(settingsFrame)
      }) ?? NSScreen.main
    guard let screen else {
      return
    }

    let preferredX = settingsFrame.maxX + 16
    let x =
      preferredX + panel.frame.width <= screen.visibleFrame.maxX
      ? preferredX
      : min(
        settingsFrame.maxX - panel.frame.width * 0.28,
        screen.visibleFrame.maxX - panel.frame.width - 16
      )
    let preferredY = settingsFrame.midY - panel.frame.height / 2
    let y = min(
      max(preferredY, screen.visibleFrame.minY + 16),
      screen.visibleFrame.maxY - panel.frame.height - 16
    )
    panel.setFrameOrigin(NSPoint(x: x, y: y))
  }

  private func systemSettingsFrame() -> CGRect? {
    guard
      let settingsApp = NSWorkspace.shared.runningApplications.first(where: {
        $0.bundleIdentifier == "com.apple.systempreferences"
      }),
      let windows = CGWindowListCopyWindowInfo(
        [.optionOnScreenOnly, .excludeDesktopElements],
        kCGNullWindowID
      ) as? [[String: Any]]
    else {
      return nil
    }

    let frames = windows.compactMap { info -> CGRect? in
      guard
        let ownerPid = info[kCGWindowOwnerPID as String] as? pid_t,
        ownerPid == settingsApp.processIdentifier,
        let layer = info[kCGWindowLayer as String] as? Int,
        layer == 0,
        let bounds = info[kCGWindowBounds as String] as? [String: NSNumber],
        let frame = CGRect(dictionaryRepresentation: bounds as CFDictionary)
      else {
        return nil
      }

      return appKitFrame(fromQuartzFrame: frame)
    }

    return frames.max(by: { first, second in
      first.width * first.height < second.width * second.height
    })
  }

  private func appKitFrame(fromQuartzFrame frame: CGRect) -> CGRect {
    guard
      let screen = NSScreen.screens.first(where: { screen in
        let quartzScreenFrame = CGRect(
          x: screen.frame.minX,
          y: screen.frame.minY,
          width: screen.frame.width,
          height: screen.frame.height
        )
        return quartzScreenFrame.intersects(frame)
      }) ?? NSScreen.main
    else {
      return frame
    }

    return CGRect(
      x: frame.minX,
      y: screen.frame.maxY - frame.maxY,
      width: frame.width,
      height: frame.height
    )
  }
}

@MainActor
private final class PermissionWindowController: NSWindowController {
  private let appearance: NSAppearance.Name?
  private let model: PermissionModel
  private lazy var companionPanelController = CompanionPanelController(
    appearance: appearance,
    model: model,
    onBack: { [weak self] in
      self?.showMainWindow()
    },
    onRestart: onRestart
  )
  private let onRestart: () -> Void

  init(
    appearance: NSAppearance.Name?,
    language: AppLanguage,
    onRestart: @escaping () -> Void
  ) {
    self.appearance = appearance
    self.onRestart = onRestart
    model = PermissionModel(language: language)
    let window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 620, height: 720),
      styleMask: [.closable, .fullSizeContentView, .miniaturizable, .titled],
      backing: .buffered,
      defer: false
    )
    window.center()
    if let appearance {
      window.appearance = NSAppearance(named: appearance)
    }
    window.isReleasedWhenClosed = false
    window.title = "Etyon Screen Awareness"
    window.titlebarAppearsTransparent = true
    window.titleVisibility = .hidden
    super.init(window: window)
    model.onPermissionRequested = { [weak self, weak window] permission in
      window?.orderOut(nil)
      self?.companionPanelController.show(permission: permission)
    }
    model.onPermissionsCompleted = { [weak self] in
      self?.companionPanelController.hide()
      self?.showMainWindow()
    }
    window.contentViewController = NSHostingController(
      rootView: PermissionOnboardingView(model: model) { [weak window] in
        window?.close()
      }
    )
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    nil
  }

  func present() {
    model.refresh()
    showMainWindow()
  }

  private func showMainWindow() {
    companionPanelController.hide()
    showWindow(nil)
    window?.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)
  }
}

private final class DualCommandMonitor: @unchecked Sendable {
  private let onChord: @MainActor @Sendable () -> Void
  private var latch = DualCommandLatch()
  private var runLoopSource: CFRunLoopSource?
  private var tap: CFMachPort?

  init(onChord: @escaping @MainActor @Sendable () -> Void) {
    self.onChord = onChord
  }

  deinit {
    stop()
  }

  func start() -> Bool {
    guard tap == nil else {
      return true
    }

    let eventMask = CGEventMask(1 << CGEventType.flagsChanged.rawValue)
    let callback: CGEventTapCallBack = { _, type, event, userInfo in
      guard let userInfo else {
        return Unmanaged.passUnretained(event)
      }

      let monitor = Unmanaged<DualCommandMonitor>
        .fromOpaque(userInfo)
        .takeUnretainedValue()

      if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
        if let tap = monitor.tap {
          CGEvent.tapEnable(tap: tap, enable: true)
        }
        return Unmanaged.passUnretained(event)
      }

      monitor.updateChordState()
      return Unmanaged.passUnretained(event)
    }

    guard
      let eventTap = CGEvent.tapCreate(
        tap: .cgSessionEventTap,
        place: .headInsertEventTap,
        options: .listenOnly,
        eventsOfInterest: eventMask,
        callback: callback,
        userInfo: Unmanaged.passUnretained(self).toOpaque()
      )
    else {
      return false
    }

    let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, eventTap, 0)
    tap = eventTap
    runLoopSource = source
    CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
    CGEvent.tapEnable(tap: eventTap, enable: true)
    return true
  }

  func stop() {
    if let runLoopSource {
      CFRunLoopRemoveSource(CFRunLoopGetMain(), runLoopSource, .commonModes)
    }

    runLoopSource = nil
    tap = nil
  }

  private func updateChordState() {
    let leftCommandIsDown = CGEventSource.keyState(.combinedSessionState, key: 55)
    let rightCommandIsDown = CGEventSource.keyState(.combinedSessionState, key: 54)

    if latch.update(
      leftCommandIsDown: leftCommandIsDown,
      rightCommandIsDown: rightCommandIsDown
    ) {
      let onChord = onChord
      Task { @MainActor in
        onChord()
      }
    }
  }
}

@MainActor
private final class ScreenAwarenessAppDelegate: NSObject, NSApplicationDelegate {
  private let language: AppLanguage
  private let appearance: NSAppearance.Name?
  private let controlMonitor: HelperControlMonitor?
  private let statusReporter: PermissionStatusReporter?
  private var monitor: DualCommandMonitor?
  private var windowController: PermissionWindowController?

  init(
    appearance: NSAppearance.Name?,
    controlFilePath: String?,
    language: AppLanguage,
    statusFilePath: String?
  ) {
    self.appearance = appearance
    self.language = language
    controlMonitor = HelperControlMonitor(path: controlFilePath)
    statusReporter = PermissionStatusReporter(path: statusFilePath)
  }

  func applicationDidFinishLaunching(_ notification: Notification) {
    NSApp.setActivationPolicy(.accessory)
    controlMonitor?.start()
    statusReporter?.start()
    let monitor = DualCommandMonitor { [weak self] in
      guard let self else {
        return
      }

      if !PermissionSnapshot.current().allGranted {
        self.presentOnboarding()
      } else {
        DistributedNotificationCenter.default().postNotificationName(
          Notification.Name("com.etcetera.etyon.screen-awareness.triggered"),
          object: nil
        )
      }
    }
    self.monitor = monitor
    _ = monitor.start()

    if CommandLine.arguments.contains("--onboard") {
      presentOnboarding()
    }
  }

  func applicationShouldHandleReopen(
    _ sender: NSApplication,
    hasVisibleWindows flag: Bool
  ) -> Bool {
    if !flag {
      presentOnboarding()
    }

    return true
  }

  func applicationWillTerminate(_ notification: Notification) {
    controlMonitor?.stop()
    statusReporter?.stop()
    monitor?.stop()
  }

  private func presentOnboarding() {
    let controller =
      windowController
      ?? PermissionWindowController(
        appearance: appearance,
        language: language
      ) { [weak self] in
        self?.restartAfterScreenRecordingAuthorization()
      }
    windowController = controller
    controller.present()
  }

  private func restartAfterScreenRecordingAuthorization() {
    statusReporter?.stop()
    monitor?.stop()

    let configuration = NSWorkspace.OpenConfiguration()
    configuration.activates = true
    configuration.arguments = Array(CommandLine.arguments.dropFirst())
    configuration.createsNewApplicationInstance = true
    NSWorkspace.shared.openApplication(
      at: Bundle.main.bundleURL,
      configuration: configuration
    ) { _, error in
      Task { @MainActor in
        guard error == nil else {
          self.statusReporter?.start()
          _ = self.monitor?.start()
          return
        }

        NSApp.terminate(nil)
      }
    }
  }
}

@main
@MainActor
private enum ScreenAwarenessMain {
  private static var delegate: ScreenAwarenessAppDelegate?

  static func main() {
    let arguments = CommandLine.arguments

    if arguments.contains("--status-json") {
      let encoder = JSONEncoder()
      encoder.outputFormatting = [.sortedKeys]
      let data = try? encoder.encode(PermissionSnapshot.current())
      FileHandle.standardOutput.write(data ?? Data("{}".utf8))
      FileHandle.standardOutput.write(Data("\n".utf8))
      return
    }

    let app = NSApplication.shared
    let appearance: NSAppearance.Name? =
      if arguments.contains("--appearance-light") {
        .aqua
      } else if arguments.contains("--appearance-dark") {
        .darkAqua
      } else {
        nil
      }
    let statusFilePath: String? =
      if let statusIndex = arguments.firstIndex(
        of: "--status-file"
      ), arguments.indices.contains(statusIndex + 1) {
        arguments[statusIndex + 1]
      } else {
        nil
      }
    let controlFilePath: String? =
      if let controlIndex = arguments.firstIndex(
        of: "--control-file"
      ), arguments.indices.contains(controlIndex + 1) {
        arguments[controlIndex + 1]
      } else {
        nil
      }
    let appDelegate = ScreenAwarenessAppDelegate(
      appearance: appearance,
      controlFilePath: controlFilePath,
      language: AppLanguage.resolve(arguments: arguments),
      statusFilePath: statusFilePath
    )
    delegate = appDelegate
    app.delegate = appDelegate
    app.run()
  }
}
