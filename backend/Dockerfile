FROM node:22-bookworm-slim AS base

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install

COPY tsconfig.json ./
COPY prisma ./prisma
COPY src ./src
RUN npm run build

ENV NODE_ENV=production
ENV PORT=4000
ENV STORAGE_DIR=/app/storage
ENV DATABASE_URL=file:/app/storage/furrbox.db

EXPOSE 4000
CMD ["node", "dist/server.js"]
