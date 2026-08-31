import AppKit
import SwiftUI

struct AppBundleDragView: NSViewRepresentable {
  let dragLabel: String
  let onDragStateChange: (Bool) -> Void
  let url: URL

  func makeNSView(context: Context) -> AppBundleDragSourceView {
    let view = AppBundleDragSourceView(dragLabel: dragLabel, url: url)
    view.onDragStateChange = onDragStateChange
    return view
  }

  func updateNSView(_ nsView: AppBundleDragSourceView, context: Context) {
    nsView.update(dragLabel: dragLabel, url: url)
    nsView.onDragStateChange = onDragStateChange
  }
}

final class AppBundleDragSourceView: NSView, NSDraggingSource {
  private var dragLabel: String
  private var hasBegunDragging = false
  private let hostingView: NSHostingView<AnyView>
  private var mouseDownPoint: NSPoint?
  private var url: URL

  var onDragStateChange: ((Bool) -> Void)?

  init(dragLabel: String, url: URL) {
    self.dragLabel = dragLabel
    self.url = url
    hostingView = NSHostingView(
      rootView: AnyView(
        AppBundleDragContent(dragLabel: dragLabel, url: url)
          .allowsHitTesting(false)
      )
    )
    super.init(frame: .zero)

    hostingView.translatesAutoresizingMaskIntoConstraints = false
    addSubview(hostingView)
    NSLayoutConstraint.activate([
      hostingView.bottomAnchor.constraint(equalTo: bottomAnchor),
      hostingView.leadingAnchor.constraint(equalTo: leadingAnchor),
      hostingView.topAnchor.constraint(equalTo: topAnchor),
      hostingView.trailingAnchor.constraint(equalTo: trailingAnchor),
    ])
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    nil
  }

  override func hitTest(_ point: NSPoint) -> NSView? {
    bounds.contains(point) ? self : nil
  }

  override func mouseDown(with event: NSEvent) {
    mouseDownPoint = convert(event.locationInWindow, from: nil)
    hasBegunDragging = false
  }

  override func mouseDragged(with event: NSEvent) {
    guard !hasBegunDragging, let mouseDownPoint else {
      return
    }

    let currentPoint = convert(event.locationInWindow, from: nil)
    let distance = hypot(
      currentPoint.x - mouseDownPoint.x,
      currentPoint.y - mouseDownPoint.y
    )
    guard distance > 4 else {
      return
    }

    hasBegunDragging = true
    beginAppDrag(with: event)
  }

  override func mouseUp(with event: NSEvent) {
    mouseDownPoint = nil
    hasBegunDragging = false
  }

  func draggingSession(
    _ session: NSDraggingSession,
    sourceOperationMaskFor context: NSDraggingContext
  ) -> NSDragOperation {
    .copy
  }

  func draggingSession(
    _ session: NSDraggingSession,
    willBeginAt screenPoint: NSPoint
  ) {
    onDragStateChange?(true)
  }

  func draggingSession(
    _ session: NSDraggingSession,
    endedAt screenPoint: NSPoint,
    operation: NSDragOperation
  ) {
    onDragStateChange?(false)
    mouseDownPoint = nil
    hasBegunDragging = false
  }

  func ignoreModifierKeys(for session: NSDraggingSession) -> Bool {
    true
  }

  func update(dragLabel: String, url: URL) {
    self.dragLabel = dragLabel
    self.url = url
    hostingView.rootView = AnyView(
      AppBundleDragContent(dragLabel: dragLabel, url: url)
        .allowsHitTesting(false)
    )
  }

  private func beginAppDrag(with event: NSEvent) {
    let draggingItem = NSDraggingItem(
      pasteboardWriter: AppBundlePasteboardWriter(url: url)
    )
    let icon = NSWorkspace.shared.icon(forFile: url.path)
    icon.size = NSSize(width: 56, height: 56)
    let dragPoint = convert(event.locationInWindow, from: nil)
    draggingItem.setDraggingFrame(
      NSRect(
        x: dragPoint.x - 28,
        y: dragPoint.y - 28,
        width: 56,
        height: 56
      ),
      contents: icon
    )

    let session = beginDraggingSession(
      with: [draggingItem],
      event: event,
      source: self
    )
    session.animatesToStartingPositionsOnCancelOrFail = true
    session.draggingFormation = .none
  }
}

final class AppBundlePasteboardWriter: NSObject, NSPasteboardWriting {
  private let url: URL

  init(url: URL) {
    self.url = url
  }

  func pasteboardPropertyList(forType type: NSPasteboard.PasteboardType) -> Any? {
    switch type {
    case .fileURL, .URL, .promisedFileURL:
      url.absoluteString
    case .filenames:
      [url.path]
    case .string:
      url.path
    default:
      nil
    }
  }

  func writableTypes(
    for pasteboard: NSPasteboard
  ) -> [NSPasteboard.PasteboardType] {
    [.fileURL, .URL, .filenames, .promisedFileURL, .string]
  }
}

extension NSPasteboard.PasteboardType {
  fileprivate static let filenames = NSPasteboard.PasteboardType("NSFilenamesPboardType")
  fileprivate static let promisedFileURL = NSPasteboard.PasteboardType(
    "com.apple.pasteboard.promised-file-url"
  )
}

private struct AppBundleDragContent: View {
  let dragLabel: String
  let url: URL

  var body: some View {
    RoundedRectangle(cornerRadius: 16, style: .continuous)
      .fill(Color.primary.opacity(0.025))
      .overlay {
        RoundedRectangle(cornerRadius: 16, style: .continuous)
          .stroke(
            Color.primary.opacity(0.2),
            style: StrokeStyle(lineWidth: 1.25, dash: [6, 6])
          )
      }
      .overlay {
        VStack(spacing: 8) {
          Image(nsImage: NSWorkspace.shared.icon(forFile: url.path))
            .resizable()
            .scaledToFit()
            .frame(width: 62, height: 62)
            .accessibilityHidden(true)
          Text(url.deletingPathExtension().lastPathComponent)
            .font(.system(size: 12, weight: .medium))
          Label(dragLabel, systemImage: "hand.draw")
            .font(.system(size: 10, weight: .medium))
            .foregroundStyle(.secondary)
        }
      }
  }
}
