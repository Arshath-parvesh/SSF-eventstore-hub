FROM node:20-slim

WORKDIR /app

# Install build dependencies for better-sqlite3 native compilation if needed
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY package*.json ./

RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
ENV PORT=3000
ENV SESSION_IDLE_TIMEOUT_MINUTES=5

EXPOSE 3000

CMD ["npm", "start"]
