import AppKit
import Testing

@testable import EtyonScreenAwareness

@Test
func dualCommandLatchTriggersOnceUntilBothKeysAreReleased() {
  var latch = DualCommandLatch()

  let leftOnly = latch.update(
    leftCommandIsDown: true,
    rightCommandIsDown: false
  )
  let firstChord = latch.update(
    leftCommandIsDown: true,
    rightCommandIsDown: true
  )
  let repeatedChord = latch.update(
    leftCommandIsDown: true,
    rightCommandIsDown: true
  )
  let rightOnlyAfterChord = latch.update(
    leftCommandIsDown: false,
    rightCommandIsDown: true
  )
  let released = latch.update(
    leftCommandIsDown: false,
    rightCommandIsDown: false
  )
  let secondChord = latch.update(
    leftCommandIsDown: true,
    rightCommandIsDown: true
  )

  #expect(!leftOnly)
  #expect(firstChord)
  #expect(!repeatedChord)
  #expect(!rightOnlyAfterChord)
  #expect(!released)
  #expect(secondChord)
}

@Test
func dualCommandLatchSupportsEitherPressOrder() {
  var latch = DualCommandLatch()

  let rightOnly = latch.update(
    leftCommandIsDown: false,
    rightCommandIsDown: true
  )
  let chord = latch.update(
    leftCommandIsDown: true,
    rightCommandIsDown: true
  )

  #expect(!rightOnly)
  #expect(chord)
}

@Test
func appBundleDragPayloadMatchesFinderStyleFileDrag() {
  let appURL = URL(fileURLWithPath: "/Applications/Etyon Screen Awareness.app")
  let writer = AppBundlePasteboardWriter(url: appURL)
  let types = writer.writableTypes(for: .general)

  #expect(types.contains(.fileURL))
  #expect(types.contains(.URL))
  #expect(
    types.contains(NSPasteboard.PasteboardType("NSFilenamesPboardType"))
  )
  #expect(writer.pasteboardPropertyList(forType: .fileURL) as? String == appURL.absoluteString)
  #expect(
    writer.pasteboardPropertyList(
      forType: NSPasteboard.PasteboardType("NSFilenamesPboardType")
    ) as? [String] == [appURL.path]
  )
}
