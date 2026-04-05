FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY config ./config
COPY ecosystem.config.js ./

EXPOSE 8080

CMD ["npm", "start"]
