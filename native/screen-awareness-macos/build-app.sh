#!/bin/bash

set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
repo_root="$(cd "$script_dir/../.." && pwd)"
desktop_resources="$repo_root/apps/desktop/resources"
output_root="$desktop_resources/screen-awareness"
app_bundle="$output_root/Etyon Screen Awareness.app"
bundle_identifier="com.etcetera.etyon.dev.screen-awareness"

if [ "${ETYON_RELEASE:-false}" = "true" ]; then
  bundle_identifier="com.etcetera.etyon.screen-awareness"
fi

swift build --package-path "$script_dir" -c release
bin_dir="$(swift build --package-path "$script_dir" -c release --show-bin-path)"

rm -rf "$app_bundle"
mkdir -p "$app_bundle/Contents/MacOS" "$app_bundle/Contents/Resources"
cp "$bin_dir/EtyonScreenAwareness" "$app_bundle/Contents/MacOS/EtyonScreenAwareness"
cp "$script_dir/Resources/Info.plist" "$app_bundle/Contents/Info.plist"
cp "$desktop_resources/icon.icns" "$app_bundle/Contents/Resources/icon.icns"
cp "$desktop_resources/icon-dark.png" "$app_bundle/Contents/Resources/icon-dark.png"
cp "$desktop_resources/icon-light.png" "$app_bundle/Contents/Resources/icon-light.png"

/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier $bundle_identifier" "$app_bundle/Contents/Info.plist"

while IFS= read -r resource_bundle; do
  cp -R "$resource_bundle" "$app_bundle/Contents/Resources/"
done < <(find "$bin_dir" -maxdepth 1 -type d -name '*.bundle' -print)

sign_identity="${ETYON_SCREEN_AWARENESS_SIGN_IDENTITY:--}"
/usr/bin/codesign --force --deep --sign "$sign_identity" "$app_bundle"

echo "$app_bundle"
