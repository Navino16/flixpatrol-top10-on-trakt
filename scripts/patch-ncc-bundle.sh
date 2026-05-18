#!/usr/bin/env bash
# Patch ncc bundle to fix jsdom/css-tree compatibility with pkg
set -euo pipefail

BUNDLE="build/tmp/index.js"

# Copy jsdom default-stylesheet.css next to the bundle so pkg can find it
cp node_modules/jsdom/lib/jsdom/browser/default-stylesheet.css build/tmp/

# Fix jsdom default-stylesheet.css path (ncc flattens the directory structure)
sed -i 's|path.resolve(__dirname, "../../../browser/default-stylesheet.css")|path.resolve(__dirname, "./default-stylesheet.css")|g' "$BUNDLE"

# Fix css-tree createRequire circular reference (ncc incorrectly converts ESM import.meta.url)
sed -i -E 's|createRequire\)\(([a-z_]+)\("url"\)\.pathToFileURL\(__filename\)\.href\)|createRequire)(__filename)|g' "$BUNDLE"

# Copy JSON files needed by css-tree's createRequire calls
# After the fix above, createRequire resolves relative to build/tmp/index.js
mkdir -p build/tmp/data
cp node_modules/css-tree/data/patch.json build/tmp/data/

# Fix the relative path for patch.json (../data/ -> ./data/ since bundle is in build/tmp/)
sed -i "s|data_patch_require('../data/patch.json')|data_patch_require('./data/patch.json')|g" "$BUNDLE"

# mdn-data is required by module name, so we copy it where node resolution finds it
mkdir -p build/tmp/node_modules/mdn-data/css
cp node_modules/mdn-data/css/at-rules.json build/tmp/node_modules/mdn-data/css/
cp node_modules/mdn-data/css/properties.json build/tmp/node_modules/mdn-data/css/
cp node_modules/mdn-data/css/syntaxes.json build/tmp/node_modules/mdn-data/css/
cp node_modules/mdn-data/package.json build/tmp/node_modules/mdn-data/

# Rewrite impit native-binding requires so pkg can statically detect them.
# ncc emits `require(__nccwpck_require__.ab + "impit-node.X.node")` which pkg's
# static analyzer cannot resolve, so the .node files are never extracted at runtime.
# Replacing the dynamic concat with a string literal lets pkg detect the native module
# and trigger its automatic extract-to-tmpdir flow.
sed -i -E 's|require\(__nccwpck_require__\.ab \+ "(impit-node\.[a-zA-Z0-9_.-]+\.node)"\)|require("./\1")|g' "$BUNDLE"
