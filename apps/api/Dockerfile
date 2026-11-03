FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY apps/api/package.json ./package.json
RUN npm install
COPY apps/api/ ./
RUN npm run build

FROM node:22-bookworm-slim AS runtime
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
EXPOSE 8080
CMD ["node", "dist/server.js"]
# Configure the separate worker service to run: npm run worker
