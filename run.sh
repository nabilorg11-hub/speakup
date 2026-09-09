#!/usr/bin/env bash
# SpeakUp - one-click local start (macOS / Linux)
# Starts a static server on port 8080 and opens the app in your browser.

set -u
cd "$(dirname "$0")" || exit 1

PORT=8080
URL="http://localhost:$PORT"

# --- pick a server -----------------------------------------------------------
if command -v python3 >/dev/null 2>&1; then
  SERVER=(python3 -m http.server "$PORT")
elif command -v python >/dev/null 2>&1; then
  SERVER=(python -m http.server "$PORT")
elif command -v npx >/dev/null 2>&1; then
  SERVER=(npx --yes http-server -p "$PORT" -c-1)
else
  echo ""
  echo "  Could not find python3, python, or npx."
  echo "  Install Python from https://www.python.org/downloads/ and run this again."
  echo ""
  read -r -p "Press Enter to close..." _
  exit 1
fi

# --- free the port if something is already on it -----------------------------
if command -v lsof >/dev/null 2>&1; then
  OLD_PID="$(lsof -ti tcp:"$PORT" 2>/dev/null | head -n 1)"
  if [ -n "${OLD_PID:-}" ]; then
    echo "Port $PORT was busy - stopping the old server (pid $OLD_PID)..."
    kill "$OLD_PID" 2>/dev/null
    sleep 1
  fi
fi

echo ""
echo "  SpeakUp is starting on $URL"
echo "  Keep this window open while you use the app."
echo "  Press Ctrl+C here to stop the server."
echo ""

# --- start the server in the background --------------------------------------
"${SERVER[@]}" >/dev/null 2>&1 &
SERVER_PID=$!

cleanup() {
  kill "$SERVER_PID" 2>/dev/null
  exit 0
}
trap cleanup INT TERM

# --- wait until it answers, then open the browser ----------------------------
for _ in $(seq 1 40); do
  if command -v curl >/dev/null 2>&1; then
    curl -s -o /dev/null "$URL" && break
  else
    sleep 0.25
    break
  fi
  sleep 0.25
done

if command -v open >/dev/null 2>&1; then
  open "$URL"            # macOS
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$URL" >/dev/null 2>&1   # Linux
else
  echo "  Open this address in your browser: $URL"
fi

wait "$SERVER_PID"
