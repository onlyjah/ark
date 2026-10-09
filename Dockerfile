# Jah Noah [Q012]: "I- I want OnlyJah to be able to run lean"
# Engineering: one runtime service, no dependency install, non-root writable persistent volume.
FROM node:24.19.0-bookworm-slim
WORKDIR /app
COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src
RUN mkdir /data && chown node:node /data
USER node
ENV ARK_DATA=/data ARK_HOST=0.0.0.0 PORT=8080
EXPOSE 8080
VOLUME ["/data"]
CMD ["node", "src/cli.ts", "serve"]
