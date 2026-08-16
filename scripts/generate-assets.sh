#!/usr/bin/env bash
set -euo pipefail

if command -v magick >/dev/null 2>&1; then
  image_tool=magick
elif command -v convert >/dev/null 2>&1; then
  image_tool=convert
else
  echo "ImageMagick is required to generate assets." >&2
  exit 1
fi

for size in 16 48 128; do
  "$image_tool" -background none assets/icon.svg -resize "${size}x${size}" "assets/icon-$size.png"
done
"$image_tool" assets/promo.svg assets/promo-440x280.png
