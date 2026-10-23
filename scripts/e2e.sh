#!/usr/bin/env bash
# Runs unit and end-to-end tests and writes a run directory under test-runs/:
# summary.md, results.xml, test.json, logs/<test>/<component>.log.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
command -v tmux >/dev/null || { echo "e2e tests need tmux" >&2; exit 1; }

id="$(date -u +%Y%m%d-%H%M%S)-$(git rev-parse --short HEAD)"
run="$PWD/test-runs/$id"
mkdir -p "$run/logs"
{ tmux -V; go version; uname -sm; node --version 2>/dev/null || echo "node: none"; } > "$run/environment.txt"
go build -o "$run/gojunit" ./tools/gojunit

# The web client: lint, unit tests, and a build that must match the
# committed dist/ byte for byte. Without Node the UI suite is skipped.
if command -v npm >/dev/null; then
    ( cd web && { [ -d node_modules ] || npm ci --no-fund --no-audit; } ) > "$run/logs/npm.log" 2>&1
    ( cd web && npm run -s lint && npx vitest run && npm run -s build ) >> "$run/logs/npm.log" 2>&1 \
        || { echo "web: lint, unit tests or build failed, see $run/logs/npm.log" >&2; exit 1; }
    if ! git diff --quiet --exit-code -- web/dist; then
        echo "web/dist is stale: run (cd web && npm run build) and commit the result" >&2
        git status --short -- web/dist >&2
        exit 1
    fi
else
    echo "npm not found: skipping the web client checks and UI tests" >&2
    export MUXWAY_SKIP_UI=1
fi

set +e
MUXWAY_RUN_DIR="$run" go test -tags e2e -count=1 -json -timeout 15m ./... > "$run/test.json"
set -e
"$run/gojunit" "$run" < "$run/test.json" && status=0 || status=$?
rm -f "$run/gojunit"
head -3 "$run/summary.md" | tail -1
echo "run directory: test-runs/$id"
exit "$status"
