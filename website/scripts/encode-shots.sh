#!/bin/sh
# Encodes the extension's real screens for the site, so the build needs no image library.
# Sources: media/screens/ (made by `pnpm media` in the repo root, not committed) and
# media/store/chrome/ (committed). Needs ImageMagick and cwebp: brew install imagemagick webp
set -eu
cd "$(dirname "$0")/.."
SCREENS=../media/screens
STORE=../media/store/chrome
OUT=src/assets/shots
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$OUT"

# webp <source> <name> [crop WxH+X+Y]
webp() {
  if [ -n "${3:-}" ]; then
    magick "$1" -crop "$3" +repage "$TMP/$2.png"
  else
    cp "$1" "$TMP/$2.png"
  fi
  cwebp -quiet -q 86 -m 6 -sharp_yuv "$TMP/$2.png" -o "$OUT/$2.webp"
  echo "$OUT/$2.webp"
}

# The hero: the invented r/BalconyGardens with the toolbar popup open, cut from the first store
# image below its headline and the browser bar (the site draws its own bar).
webp "$STORE/01-thread.png" hero-page 1152x596+64+204
# The popup on a subreddit, whole.
webp "$SCREENS/popup-subreddit.png" popup-subreddit
# The export tab mid-run, without the empty space under it.
webp "$SCREENS/export-running.png" export-running 1280x690+0+0
# Settings: the "Files in the ZIP" card.
webp "$SCREENS/settings.png" settings-files 680x300+300+130
# The Apify section's banner (media/readme, committed).
webp ../media/readme/apify-banner.png apify-banner
