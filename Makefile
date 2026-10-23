# Common tasks. The web client is built into web/dist, which is committed.
.PHONY: build web test e2e lint

build: ## the muxway binary
	go build ./cmd/muxway

web: ## rebuild the embedded web client
	cd web && npm ci --no-fund --no-audit && npm run build

test: ## unit tests
	go test ./...
	cd web && npx vitest run

e2e: ## the full suite with a run directory
	scripts/e2e.sh

lint:
	go vet ./...
	cd web && npm run lint
