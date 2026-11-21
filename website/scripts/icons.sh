#!/bin/sh
# The site's icons, from the extension's own brand files (media/brand, drawn from src/ui/logo.ts).
# Needs rsvg-convert and ImageMagick: brew install librsvg imagemagick
set -eu
cd "$(dirname "$0")/.."
BRAND=../media/brand
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

cp "$BRAND/icon.svg" public/favicon.svg
# favicon.ico: the 16 px drawing (fewer, thicker stitches) at 16, the full one at 32 and 48.
rsvg-convert -w 16 -h 16 "$BRAND/icon-small.svg" -o "$TMP/16.png"
rsvg-convert -w 32 -h 32 "$BRAND/icon.svg" -o "$TMP/32.png"
rsvg-convert -w 48 -h 48 "$BRAND/icon.svg" -o "$TMP/48.png"
magick "$TMP/16.png" "$TMP/32.png" "$TMP/48.png" public/favicon.ico
# iOS rounds the corners itself, so its icon is the orange square without transparent corners.
rsvg-convert -w 180 -h 180 "$BRAND/icon.svg" | magick - -background '#ff4500' -flatten public/apple-touch-icon.png
# For structured data (the Organization's logo).
rsvg-convert -w 512 -h 512 "$BRAND/icon.svg" -o public/logo-512.png
