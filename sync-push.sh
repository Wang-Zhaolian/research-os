#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
git add data app components lib docs tests README.md package.json package-lock.json
if ! git diff --cached --quiet; then
  git commit -m "data: sync Research OS $(date '+%Y-%m-%d %H:%M')"
fi
git pull --rebase
git push
printf '%s\n' "Research OS has been synced."
