#!/bin/sh
# One-time GitHub setup for submit.yml: the store keys as secrets, the store IDs as variables,
# and the store-submit environment, which makes every store upload wait for jasp's approval
# and only runs for v* tags. Run it again after renewing a key (the Edge key expires).
#
# Reads from ~/.config/threadcrate/ (the same keys as Canvas Course Downloader: one CWS
# service account per publisher, AMO keys per user, the Edge key per Partner Center account;
# copy or symlink the files):
#   cws-key.json  the Chrome Web Store service account's JSON key
#   cws.env       CHROME_PUBLISHER_ID=…  CHROME_EXTENSION_ID=… (Threadcrate's item id)
#   amo.env       FIREFOX_JWT_ISSUER=…  FIREFOX_JWT_SECRET=…
#   edge.env      EDGE_CLIENT_ID=…  EDGE_API_KEY=…  EDGE_PRODUCT_ID=… (Threadcrate's product id)
# Prints none of the values.
set -eu
DIR="$HOME/.config/threadcrate"
REPO=jasp-nerd/threadcrate

for f in cws-key.json cws.env amo.env edge.env; do
  test -r "$DIR/$f" || { echo "Missing $DIR/$f" >&2; exit 1; }
done

# The value of KEY in FILE, or stop with the key's name (never its value).
val() {
  v=$(grep -E "^$1=" "$2" | head -1 | cut -d= -f2-)
  test -n "$v" || { echo "No $1 in $2" >&2; exit 1; }
  printf '%s' "$v"
}
# Sets a secret from stdin, so the value never appears in arguments or output.
secret() { gh secret set "$1" -R "$REPO" >/dev/null; }

# Check every value is there before changing anything on GitHub.
for k in CHROME_PUBLISHER_ID CHROME_EXTENSION_ID; do val "$k" "$DIR/cws.env" >/dev/null; done
for k in FIREFOX_JWT_ISSUER FIREFOX_JWT_SECRET; do val "$k" "$DIR/amo.env" >/dev/null; done
for k in EDGE_CLIENT_ID EDGE_API_KEY EDGE_PRODUCT_ID; do val "$k" "$DIR/edge.env" >/dev/null; done

# The approval gate first, so no secret is ever usable without it.
ME=$(gh api user --jq .id)
printf '{"reviewers":[{"type":"User","id":%s}],"deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}' "$ME" |
  gh api -X PUT "repos/$REPO/environments/store-submit" --input - >/dev/null
gh api -X POST "repos/$REPO/environments/store-submit/deployment-branch-policies" -f name='v*' -f type=tag >/dev/null 2>&1 || true

node -e 'process.stdout.write(require(process.argv[1]).client_email)' "$DIR/cws-key.json" | secret CHROME_SERVICE_ACCOUNT_CLIENT_EMAIL
node -e 'process.stdout.write(require(process.argv[1]).private_key)' "$DIR/cws-key.json" | secret CHROME_SERVICE_ACCOUNT_PRIVATE_KEY
val FIREFOX_JWT_ISSUER "$DIR/amo.env" | secret FIREFOX_JWT_ISSUER
val FIREFOX_JWT_SECRET "$DIR/amo.env" | secret FIREFOX_JWT_SECRET
val EDGE_CLIENT_ID "$DIR/edge.env" | secret EDGE_CLIENT_ID
val EDGE_API_KEY "$DIR/edge.env" | secret EDGE_API_KEY

# IDs aren't secret, but they are per product: Threadcrate's own, not the sibling's.
gh variable set CHROME_EXTENSION_ID -R "$REPO" --body "$(val CHROME_EXTENSION_ID "$DIR/cws.env")"
gh variable set CHROME_PUBLISHER_ID -R "$REPO" --body "$(val CHROME_PUBLISHER_ID "$DIR/cws.env")"
gh variable set FIREFOX_EXTENSION_ID -R "$REPO" --body threadcrate@jasp-nerd
gh variable set EDGE_PRODUCT_ID -R "$REPO" --body "$(val EDGE_PRODUCT_ID "$DIR/edge.env")"
# Chrome publishes as soon as Google approves: the approval on store-submit is the human step.
gh variable delete CHROME_PUBLISH_TYPE -R "$REPO" 2>/dev/null || true

# Private vulnerability reporting (SECURITY.md links to it) and immutable releases.
gh api -X PUT "repos/$REPO/private-vulnerability-reporting" >/dev/null 2>&1 ||
  echo "Turn on private vulnerability reporting by hand: Settings › Security"
gh api -X PUT "repos/$REPO/immutable-releases" >/dev/null 2>&1 ||
  echo "Turn on immutable releases by hand: Settings › General › Releases"

echo "Done: store-submit needs your approval and only runs for v* tags. Secrets:"
gh secret list -R "$REPO" | cut -f1
