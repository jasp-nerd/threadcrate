#!/bin/sh
# On the server, every 12 hours (cron) until the Chrome Web Store listing is live:
# then rebuilds the website with its "Add to Chrome" button, deploys it, and removes
# itself and its cron line. Needs git, curl and Docker; nothing stays installed.
#   install: copy to /opt/threadcrate-site/store-watch.sh, then
#   (crontab -l 2>/dev/null; echo '17 */12 * * * /opt/threadcrate-site/store-watch.sh >> /opt/threadcrate-site/store-watch.log 2>&1') | crontab -
# FORCE=1 builds without waiting for the listing; DRY=1 builds but doesn't deploy or remove itself.
set -eu
ID=nhgjbajgfmnpgodnmikmobfogdodbdgn
SITE=/opt/threadcrate-site
title=$(curl -sSL -A 'Mozilla/5.0' "https://chromewebstore.google.com/detail/$ID" | grep -o '<title>[^<]*</title>' | head -1 || true)
case "$title" in
  *Threadcrate*) ;;
  *) [ "${FORCE:-}" = 1 ] || { echo "$(date -u +%FT%TZ) pending"; exit 0; } ;;
esac
echo "$(date -u +%FT%TZ) live: rebuilding the site"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
git clone -q --depth 1 https://github.com/jasp-nerd/threadcrate.git "$tmp/repo"
# The listing's link goes in the site's data here too, in case GitHub hasn't committed it yet.
sed -i "s|chrome: '',|chrome: 'https://chromewebstore.google.com/detail/$ID',|" "$tmp/repo/website/src/data/site.ts"
# The root tsconfig extends WXT's generated one, which only exists after `wxt prepare`;
# the website needs no more than a stand-in to read the two extension files it shares.
mkdir -p "$tmp/repo/.wxt" && echo '{}' > "$tmp/repo/.wxt/tsconfig.json"
docker run --rm --memory 1g --cpus 1 -v "$tmp/repo:/repo" -w /repo/website node:24-alpine sh -c \
  'npm install -g -s pnpm@11.28.6 && pnpm install -s --frozen-lockfile && SITE_URL=https://threadcrate.jaspnerd.dev BASE_PATH=/ pnpm -s build'
[ "${DRY:-}" = 1 ] && { ls "$tmp/repo/website/dist" | head; exit 0; }
rsync -a --delete "$tmp/repo/website/dist/" "$SITE/public/"
crontab -l | grep -v store-watch.sh | crontab -
rm -f -- "$0"
echo "$(date -u +%FT%TZ) deployed; watcher removed"
