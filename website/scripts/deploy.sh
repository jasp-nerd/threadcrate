#!/bin/sh
# Builds the site for threadcrate.jaspnerd.dev and copies it to the Hetzner server, whose web
# server serves /opt/threadcrate-site/public. Needs the `hetzner` SSH host.
set -eu
cd "$(dirname "$0")/.."
SITE_URL=https://threadcrate.jaspnerd.dev BASE_PATH=/ pnpm build
rsync -az --delete dist/ hetzner:/opt/threadcrate-site/public/
echo "Deployed to https://threadcrate.jaspnerd.dev"
