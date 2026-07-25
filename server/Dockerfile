FROM node:20-bookworm-slim AS build

WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY server/package.json server/package.json
COPY client/package.json client/package.json
RUN npm ci

COPY server server
RUN npm run db:generate --workspace=server
RUN npm run build:server

FROM node:20-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV AI_BACKGROUND_REMOVAL_PYTHON=/opt/ai-venv/bin/python

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates wget python3 python3-venv \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY server/package.json server/package.json
COPY client/package.json client/package.json
RUN npm ci --omit=dev --workspace=server

COPY --from=build /app/server/dist server/dist
COPY --from=build /app/server/prisma server/prisma
COPY server/requirements-ai.txt server/requirements-ai.txt
COPY server/scripts server/scripts
RUN python3 -m venv /opt/ai-venv \
  && /opt/ai-venv/bin/python -m pip install --no-cache-dir --upgrade pip \
  && /opt/ai-venv/bin/python -m pip install --no-cache-dir -r server/requirements-ai.txt
RUN npm run db:generate --workspace=server

EXPOSE 5000
CMD ["node", "server/dist/server.js"]
