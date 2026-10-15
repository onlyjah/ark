# All build steps are ordinary npm, copy and Go commands. No remote shell script.
GO ?= go

.PHONY: client build test check-go run
client:
	npm ci --prefix client --ignore-scripts
	npm run --prefix client build

build: client
	mkdir -p backend/internal/client/static/app
	cp -R client/dist/. backend/internal/client/static/app/
	cp backend/THIRD-PARTY-NOTICES.txt backend/internal/client/static/app/
	cd backend && CGO_ENABLED=0 $(GO) build -trimpath -o bin/kash ./cmd/kash

check-go:
	cd backend && $(GO) vet ./...
	cd backend && $(GO) test -race ./...

test: check-go
	npm run --prefix client check
	node --test client/test/*.test.ts

run: build
	./backend/bin/kash serve
