#!/bin/sh
# Starts ShiftRhythm on this computer only (127.0.0.1 is not reachable from other devices).
cd "$(dirname "$0")" || exit 1
PORT=8642
URL="http://127.0.0.1:$PORT/"
echo "ShiftRhythm is running at $URL"
echo "Keep this window open while you use it. Press Ctrl+C to stop."
( sleep 1; (command -v xdg-open >/dev/null && xdg-open "$URL") || (command -v open >/dev/null && open "$URL") ) >/dev/null 2>&1 &
if command -v python3 >/dev/null 2>&1; then exec python3 -m http.server "$PORT" --bind 127.0.0.1
else exec python -m http.server "$PORT" --bind 127.0.0.1; fi
