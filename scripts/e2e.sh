#!/usr/bin/env bash
# Runs unit and end-to-end tests and writes a run directory under test-runs/:
# summary.md, results.xml, test.json, logs/<test>/<component>.log.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
command -v tmux >/dev/null || { echo "e2e tests need tmux" >&2; exit 1; }

id="$(date -u +%Y%m%d-%H%M%S)-$(git rev-parse --short HEAD)"
run="$PWD/test-runs/$id"
mkdir -p "$run/logs"
{ tmux -V; go version; uname -sm; } > "$run/environment.txt"
go build -o "$run/gojunit" ./tools/gojunit

set +e
MUXWAY_RUN_DIR="$run" go test -tags e2e -count=1 -json -timeout 15m ./... > "$run/test.json"
set -e
"$run/gojunit" "$run" < "$run/test.json" && status=0 || status=$?
rm -f "$run/gojunit"
head -3 "$run/summary.md" | tail -1
echo "run directory: test-runs/$id"
exit "$status"
