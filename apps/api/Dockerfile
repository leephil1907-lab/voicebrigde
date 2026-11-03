FROM node:22-bookworm-slim AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/mobile/package.json apps/mobile/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN npm ci --workspace @voicebridge/api --workspace @voicebridge/web --include-workspace-root --no-audit --no-fund
COPY apps/api/ apps/api/
COPY apps/web/ apps/web/
RUN npm run build:api && npm run build:web

FROM node:22-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production WEB_DIST_PATH=/app/web-dist
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/apps/api/package.json ./package.json
COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/apps/web/dist ./web-dist
EXPOSE 8080
CMD ["node", "dist/server.js"]
# Run a separate worker service from this image with command: npm run worker
