FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY config/default.json ./config/default.json
COPY config/accounts.example.json ./config/accounts.example.json

EXPOSE 8080

CMD ["npm", "start"]
