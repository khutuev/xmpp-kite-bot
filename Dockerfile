FROM node:22-alpine

WORKDIR /app

# Копируем зависимости и устанавливаем их
COPY package*.json ./
RUN npm install

# Копируем исходный код
COPY . .

USER node

EXPOSE 3000

CMD ["npx", "ts-node", "src/index.ts"]
