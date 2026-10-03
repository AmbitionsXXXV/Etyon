import AppKit
import Testing

@Test func captureTextBoundsUnicodeWithoutBreakingCharactersOrKeepingControlData() {
  let family = "👨‍👩‍👧‍👦"
  #expect(CaptureTextPolicy.bounded(family + "中", utf16Limit: family.utf16.count) == family)
  #expect(CaptureTextPolicy.bounded(family, utf16Limit: 2).isEmpty)
  #expect(CaptureTextPolicy.bounded("a\u{0}b\nc", utf16Limit: 10) == "ab\nc")
  #expect(CaptureTextPolicy.bounded(String(repeating: "中", count: 30_000), utf16Limit: 24_000).utf16.count == 24_000)
}

@Test func helperTerminationCannotBeOverwrittenByOnboardingOrAffectNewLaunch() {
  #expect(HelperCommandPolicy.accepts(command: "terminate", issuedAt: 2000, targetInstanceId: nil, instanceId: "old", startedAt: 1000, now: 2500))
  #expect(!HelperCommandPolicy.accepts(command: "terminate", issuedAt: 2000, targetInstanceId: nil, instanceId: "new", startedAt: 2200, now: 2500))
  #expect(HelperCommandPolicy.accepts(command: "onboard", issuedAt: 2300, targetInstanceId: "new", instanceId: "new", startedAt: 2200, now: 2500))
  #expect(!HelperCommandPolicy.accepts(command: "onboard", issuedAt: 2300, targetInstanceId: "new", instanceId: "old", startedAt: 1000, now: 2500))
}

@Test func helperCommandsRejectInvalidExpiredAndFutureEvents() {
  #expect(!HelperCommandPolicy.accepts(command: "capture", issuedAt: .nan, targetInstanceId: "live", instanceId: "live", startedAt: 0, now: 1000))
  #expect(!HelperCommandPolicy.accepts(command: "capture", issuedAt: 0, targetInstanceId: "live", instanceId: "live", startedAt: 0, now: 700_000))
  #expect(!HelperCommandPolicy.accepts(command: "capture", issuedAt: 100_000, targetInstanceId: "live", instanceId: "live", startedAt: 0, now: 1000))
  #expect(!HelperCommandPolicy.accepts(command: "unknown", issuedAt: 500, targetInstanceId: "live", instanceId: "live", startedAt: 0, now: 1000))
}

@testable import EtyonScreenAwareness

@Test
func focusedWindowIsSelectedInsteadOfLargestWindow() {
  let focused = CaptureWindowCandidate(bounds: CGRect(x: 10, y: 20, width: 200, height: 100), id: 1, title: "Focused")
  let larger = CaptureWindowCandidate(bounds: CGRect(x: 0, y: 0, width: 900, height: 800), id: 2, title: "Other")
  #expect(CapturePolicy.selectWindow(candidates: [larger, focused], focusedBounds: focused.bounds, focusedTitle: focused.title) == focused)
}

@Test
func windowTargetDoesNotFallBackWhenLockedWindowDisappears() {
  let other = CaptureWindowCandidate(bounds: CGRect(x: 0, y: 0, width: 900, height: 800), id: 2, title: "Other")
  #expect(CapturePolicy.selectWindow(candidates: [other], focusedBounds: CGRect(x: 10, y: 20, width: 200, height: 100), focusedTitle: "Focused") == nil)
}

@Test
func screenshotOnlyCaptureUsesFrontmostWindowOrder() {
  let front = CaptureWindowCandidate(bounds: CGRect(x: 10, y: 20, width: 200, height: 100), id: 1, title: nil)
  let larger = CaptureWindowCandidate(bounds: CGRect(x: 0, y: 0, width: 900, height: 800), id: 2, title: nil)
  #expect(CapturePolicy.selectWindow(candidates: [front, larger], focusedBounds: nil, focusedTitle: nil) == front)
}

@Test
func protectedAppsAndHostAreExcluded() {
  #expect(!CapturePolicy.allows(bundleId: "com.etcetera.etyon.dev"))
  #expect(!CapturePolicy.allows(bundleId: "com.1password.1password"))
  #expect(!CapturePolicy.allows(bundleId: "com.apple.systempreferences"))
  #expect(CapturePolicy.allows(bundleId: "com.apple.TextEdit"))
}
