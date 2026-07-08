FROM node:20-alpine
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm install
COPY download_model.js ./
RUN node download_model.js
COPY . .
EXPOSE 3001
CMD ["npm", "start"]
