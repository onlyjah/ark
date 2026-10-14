# One image, five service roles. Compact is the budget-preserving default.
FROM node:24.19.0-bookworm-slim AS build
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY src ./src
COPY packages ./packages
COPY services ./services
COPY plugins ./plugins
COPY xtp ./xtp
COPY scripts ./scripts
COPY web ./web
RUN node scripts/build-railway.ts
FROM oven/bun:1.4.0
WORKDIR /app
COPY --from=build /build/dist ./
COPY --from=build /build/railway/ark-core.function.ts ./compact.mjs
RUN mkdir -p /data && chown bun:bun /data
USER bun
ENV ARK_DATA=/data ARK_VOLUME_MOUNT_PATH=/data PORT=8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD bun -e 'const r=await fetch("http://127.0.0.1:8080/health");process.exit(r.ok?0:1)'
EXPOSE 8080
VOLUME ["/data"]
CMD ["bun", "/app/compact.mjs"]
