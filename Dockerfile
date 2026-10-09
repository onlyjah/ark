# Portable host profile. Pin a verified image digest before production promotion.
FROM node:24-alpine
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --prod --frozen-lockfile
COPY src ./src
COPY contracts ./contracts
COPY data ./data
USER node
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "src/node.mjs"]
