FROM node:22-alpine

WORKDIR /app

# Копируем зависимости и устанавливаем их
COPY package*.json ./
RUN npm install

# Копируем исходный код
COPY . .

# Создаем директорию для базы данных и назначаем права
RUN mkdir -p /external_db && chown node:node /external_db
VOLUME /external_db

USER node

EXPOSE 3000

CMD ["npx", "ts-node", "src/index.ts"]
