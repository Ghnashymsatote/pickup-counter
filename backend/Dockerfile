
FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
COPY sql ./sql
COPY tests ./tests

RUN npm run build

EXPOSE 5001

CMD ["npm", "start"]
