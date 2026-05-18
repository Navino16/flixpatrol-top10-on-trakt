#!/usr/bin/env bash
# Force-install `impit`'s native bindings for every target packaged by `pkg`.
# npm only installs the optional binding matching the host platform, so without this
# step the cross-platform binaries produced by `pkg` would crash at startup with
# "impit couldn't load native bindings".
set -euo pipefail

IMPIT_VERSION=$(node -p "require('./node_modules/impit/package.json').version")

# Targets must match the `pkg.targets` entries in package.json.
BINDINGS=(
  "impit-linux-x64-gnu"
  "impit-linux-arm64-gnu"
  "impit-darwin-x64"
  "impit-darwin-arm64"
  "impit-win32-x64-msvc"
)

PACKAGES=()
for pkg in "${BINDINGS[@]}"; do
  PACKAGES+=("${pkg}@${IMPIT_VERSION}")
done

npm install --no-save --force --os=any --cpu=any "${PACKAGES[@]}"
