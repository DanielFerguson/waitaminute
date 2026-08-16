#!/usr/bin/env bash
set -euo pipefail
version="$(node -p "require('./manifest.json').version")"
archive="waitaminute-${version}.zip"
rm -rf .package
rm -f "$archive"
mkdir .package
cp -R manifest.json LICENSE README.md assets background block content popup shared .package/
rm -f .package/assets/icon.svg .package/assets/promo.svg .package/assets/promo-440x280.png
(
  cd .package
  zip -qr "../$archive" . -x '*.DS_Store'
)
rm -rf .package
