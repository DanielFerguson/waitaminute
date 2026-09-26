#!/usr/bin/env bash
set -euo pipefail
version="$(node -p "require('./manifest.json').version")"
archive="waitaminute-${version}.zip"
rm -f "$archive"
zip -qr "$archive" manifest.json LICENSE assets/icon-16.png assets/icon-48.png assets/icon-128.png \
  background block content popup shared -x '*.DS_Store'
