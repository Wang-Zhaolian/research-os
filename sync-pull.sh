#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
git pull --rebase --autostash
printf '%s\n' "Research OS is up to date."
