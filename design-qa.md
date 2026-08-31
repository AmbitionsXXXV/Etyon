# Screen Awareness Permission Onboarding Design QA

## Evidence

- Source visual truth: `doc/assets/screen-awareness/design-reference.png`
- Initial permission window: `doc/assets/screen-awareness/implementation-main.png`
- System Settings companion panel: `doc/assets/screen-awareness/implementation-companion.png`
- Combined comparison: `doc/assets/screen-awareness/design-comparison.png`
- Source pixels: `1586 × 992`
- Implementation pixels: main `620 × 748`; companion `450 × 344`
- Native layout size: main `620 × 720` points plus title bar; companion `450 × 344` points
- Theme: forced light appearance for fidelity comparison; production defaults to system appearance
- Density normalization: Computer Use captures were treated as 1× native-window evidence and placed below a `1200 × 750` normalized source frame in the combined comparison
- State: both permissions missing; first onboarding screen and Accessibility companion step

## Full-View Comparison

The implementation now preserves the selected flow's hierarchy:

1. Etyon brand icon and dual-Command explanation.
2. Two physical Command keycaps with a restrained connection cue.
3. `0 / 2` permission progress and one grouped two-row permission surface.
4. Privacy reassurance before the actions.
5. One weak action and one high-contrast primary action.
6. A separate companion panel with draggable helper App, `1 / 2`, next step, current permission and waiting state.

The native implementation is intentionally captured without the mock's presentation canvas and directional arrow. Those are storyboard framing, not app-owned UI.

## Focused Region Comparison

### Initial permission window

- Typography: native SF Pro closely matches the mock's macOS product typography; hierarchy, weights and wrapping remain equivalent.
- Spacing: the implementation follows the same vertical rhythm and grouped permission rows. It uses slightly more lower whitespace to accommodate native title-bar geometry.
- Color: semantic light material is slightly grayer than the generated mock's near-white surface, but preserves contrast and adapts to macOS appearance.
- Assets: the real Etyon light icon is used; system actions use SF Symbols rather than custom SVG or text substitutes.
- Copy: title, permission names, privacy promise, progress, `稍后` and `设置权限` match the selected direction.

### Companion panel

- The implementation replaces the stock PermissionFlow panel with an Etyon-owned `450 × 344` SwiftUI/AppKit panel because the stock panel could not represent progress or the next step.
- It includes the selected draggable App well, `1 / 2`, next permission, current permission, waiting indicator and back action.
- The panel follows the System Settings window through a bounded Window Server frame lookup and falls back to the current screen edge if the target window cannot be resolved.
- The real Etyon helper App bundle is the drag payload and the visible asset.

## Primary Interactions Tested

- Opened the signed helper from the packaged Electron App resources.
- Verified the initial window accessibility tree and both actions.
- Activated `设置权限`.
- Verified System Settings opened to the macOS permission surface and listed `Etyon Screen Awareness.app`.
- Verified the main onboarding window hides while the companion panel is active.
- Verified companion title, drag target, progress, next step, waiting state and back action.
- Did not automate the TCC switch; the user remains the authority for changing macOS privacy settings.

## Comparison History

### Iteration 1

- [P1] The initial implementation used the earlier wide split layout instead of the selected narrow vertical window.
- Fix: changed the native window to a `620 × 720` vertical composition and used the light/dark Etyon assets directly.
- Post-fix evidence: `implementation-main.png`.

- [P2] The permission section reused the primary button label as its heading, and the primary action lacked enough contrast in dark appearance.
- Fix: added a dedicated `权限检查` label and semantic high-contrast tint.
- Post-fix evidence: `implementation-main.png` and the verified accessibility tree.

### Iteration 2

- [P1] The stock PermissionFlow accessory was a compact one-line drag prompt and omitted `1 / 2`, next permission and the selected visual hierarchy.
- Fix: retained PermissionFlow's `SystemSettingsKit` deeplinks but implemented an Etyon-owned companion panel with progress, drag payload, waiting state and target-window tracking.
- Post-fix evidence: `implementation-companion.png`.

- [P2] The outer Electron App signature was invalid after packaging finalization even though the nested helper signature was valid.
- Fix: added a Forge `postPackage` signing closure and verified both the outer App and nested helper with `codesign --verify --deep --strict`.
- Post-fix evidence: successful package and codesign readback in the implementation run.

## Findings

No actionable P0, P1 or P2 visual findings remain for the Phase 1 permission onboarding slice.

## Follow-up Polish

- [P3] The native light material is slightly grayer than the generated mock. Keep the adaptive material unless future signed-build screenshots show insufficient separation from System Settings.
- [P3] Validate the companion panel's physical offset on a second monitor and a narrow display; its fallback is implemented but has not been visually captured in those geometries.

## Implementation Checklist

- [x] Initial permission UI matches the selected vertical direction.
- [x] Companion panel matches the selected System Settings direction.
- [x] Both controls expose readable Accessibility names.
- [x] Real helper App is the TCC and drag identity.
- [x] Electron package embeds the helper.
- [x] Outer App and nested helper signatures validate.
- [ ] Re-run TCC permission readback with the final Developer ID signature; ad-hoc rebuilds intentionally change the designated requirement.
- [ ] Continue with window capture, AX text extraction and Chat staged context.

final result: passed
