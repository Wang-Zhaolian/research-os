#!/usr/bin/env bash
set -euo pipefail
SOURCE="$(readlink "$0" 2>/dev/null || true)"
if [ -z "$SOURCE" ]; then SOURCE="$0"; fi
ROOT_DIR="$(cd "$(dirname "$SOURCE")" && pwd)"
cd "$ROOT_DIR"
node scripts/launch.mjs || { echo; echo "Research OS 启动失败，请查看上方提示。按回车关闭窗口。"; read -r; exit 1; }
