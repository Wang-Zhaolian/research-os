#!/usr/bin/env sh
set -eu
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
TARGET="$PROJECT_ROOT/start-research-os.command"
DESKTOP="${HOME}/Desktop"
if [ ! -f "$TARGET" ]; then echo "找不到 Research OS 启动入口：$TARGET" >&2; exit 1; fi
mkdir -p "$DESKTOP"
chmod +x "$TARGET"
LINK=""
for INDEX in 1 2 3 4 5 6 7 8 9 10; do
  if [ "$INDEX" -eq 1 ]; then NAME="Research OS.command"; else NAME="Research OS Local ($INDEX).command"; fi
  CANDIDATE="$DESKTOP/$NAME"
  if [ -L "$CANDIDATE" ] && [ "$(readlink "$CANDIDATE")" = "$TARGET" ]; then echo "桌面入口已存在：$CANDIDATE"; exit 0; fi
  if [ ! -e "$CANDIDATE" ] && [ ! -L "$CANDIDATE" ]; then LINK="$CANDIDATE"; break; fi
done
if [ -z "$LINK" ]; then echo "No free Research OS desktop shortcut name is available." >&2; exit 1; fi
ln -s "$TARGET" "$LINK"
echo "桌面入口已创建：$LINK"
