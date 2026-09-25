#!/usr/bin/env bash
# CounselNote launcher for macOS/Linux
set -e
cd "$(dirname "$0")"
PORT=8790
echo "Starting CounselNote at http://127.0.0.1:$PORT"
node server.js &
SERVER_PID=$!
sleep 1
URL="http://127.0.0.1:$PORT"
if command -v open >/dev/null 2>&1; then open "$URL"; elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL"; fi
echo "Press Ctrl+C to stop CounselNote."
wait $SERVER_PID
