FROM node:22-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

# --- runtime -----------------------------------------------------------------
FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production

# Production dependencies only; tsc and the test runner are build-time tools.
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
# The migration runner reads these at boot.
COPY sql ./sql

# Run unprivileged; the base image ships a `node` user.
USER node

EXPOSE 5001

CMD ["node", "dist/index.js"]
