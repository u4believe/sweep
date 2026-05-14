FROM node:22-slim

# Install build tools needed for native addons (bcrypt etc.)
RUN apt-get update && apt-get install -y python3 make g++ --no-install-recommends && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm@10.33.0

# Copy workspace manifest files first (better layer caching)
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY tsconfig.base.json tsconfig.json ./

# Copy all workspace packages needed for the build
COPY lib/ ./lib/
COPY artifacts/api-server/ ./artifacts/api-server/
COPY artifacts/usdc-send/ ./artifacts/usdc-send/

# Install all workspace dependencies
RUN pnpm install --frozen-lockfile

# Build the frontend first, then the api-server
RUN pnpm --filter @workspace/usdc-send build
RUN pnpm --filter @workspace/api-server build

WORKDIR /app/artifacts/api-server

EXPOSE 3001

ENV NODE_OPTIONS="--max-old-space-size=4096"

CMD ["node", "./dist/index.mjs"]