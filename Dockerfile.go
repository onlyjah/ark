# KA$H.app Go migration image. Read docs/BUILD.md for every stage and dependency.
# Node builds browser assets; it is not copied into the running image.
FROM node:24.19.0-bookworm-slim AS frontend
WORKDIR /client
COPY client/package.json client/package-lock.json ./
# Install the exact lockfile without executing dependency lifecycle scripts.
RUN npm ci --ignore-scripts
COPY client/ ./
COPY ui/ /ui/
COPY xtp/soil/ /xtp/soil/
COPY web/kash/ /web/kash/
# Type-check TypeScript, then let Vite bundle static HTML, CSS and JavaScript.
RUN npm run build

# Go compiles the HTTP server and native folder bridge into one executable.
FROM golang:1.27.2-alpine AS backend
WORKDIR /src
COPY backend/go.mod backend/go.sum ./
# Module checksums are in go.sum; verify downloaded modules before compiling.
RUN go mod download && go mod verify
COPY backend/ ./
# go:embed packages the same React build into the portable executable.
COPY --from=frontend /client/dist/ ./internal/client/static/app/
RUN cp THIRD-PARTY-NOTICES.txt internal/client/static/app/
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/kash ./cmd/kash

# A small Linux runtime with TLS trust roots. No Go, Node, Bun or npm at runtime.
FROM alpine:3.23
RUN apk add --no-cache ca-certificates && adduser -D -u 10001 kash
WORKDIR /app
COPY --from=backend /out/kash /app/kash
COPY backend/THIRD-PARTY-NOTICES.txt /usr/share/doc/kash/THIRD-PARTY-NOTICES.txt
RUN mkdir -p /data/kash-go && chown -R kash:kash /data
USER kash
ENV PORT=8080 KASH_LISTEN_HOST=0.0.0.0 KASH_DATA=/data/kash-go
EXPOSE 8080
# Railway or Compose supplies the actual mount. Docker VOLUME is unnecessary.
CMD ["/app/kash", "serve"]
