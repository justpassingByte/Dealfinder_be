# Stage 1: Build Node project
FROM node:20-bookworm AS builder

WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# Stage 2: Production environment
FROM node:20-bookworm-slim

# Install Python, Chromium and required libs for DrissionPage
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    chromium \
    socat \
    libgbm1 \
    libnss3 \
    libatk-bridge2.0-0 \
    libgtk-3-0 \
    && rm -rf /var/lib/apt/lists/*

# Fix python alias
RUN ln -s /usr/bin/python3 /usr/bin/python

# Install Python dependencies
RUN pip3 install DrissionPage --break-system-packages --no-cache-dir

WORKDIR /app

# Copy built node assets
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/dist ./dist
# We need node_modules for production
RUN npm install --omit=dev

# Copy scripts and profiles
COPY --from=builder /app/scripts ./scripts
# Copy sql migrations because tsc doesn't copy them
COPY --from=builder /app/src/migrations ./dist/src/migrations
COPY --from=builder /app/migrations ./dist/migrations
# Ensure the shopee_user_profile directory exists or is copied
COPY --from=builder /app/shopee_user_profile ./shopee_user_profile

EXPOSE 4000

ENV NODE_ENV=production
ENV PYTHONUNBUFFERED=1

CMD ["npm", "start"]
