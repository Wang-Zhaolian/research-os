#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
git rev-parse --show-toplevel >/dev/null
exec node scripts/sync.mjs pull
