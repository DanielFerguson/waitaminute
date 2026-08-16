#!/usr/bin/env bash
set -euo pipefail
for size in 16 48 128; do
  magick -background none assets/icon.svg -resize "${size}x${size}" "assets/icon-$size.png"
done
magick assets/promo.svg assets/promo-440x280.png
