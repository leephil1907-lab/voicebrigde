FROM node:22-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY apps/mobile/package.json ./apps/mobile/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json

RUN npm ci

COPY . .

RUN npm run build:api && npm run build:web

ENV HOST=0.0.0.0
EXPOSE 10000

CMD ["npm", "run", "start:render"]
