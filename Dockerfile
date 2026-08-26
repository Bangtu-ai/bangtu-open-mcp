ARG NODE_VERSION=22.19.0
FROM registry.bangtu-ai.com/library/node:${NODE_VERSION}-pm2

WORKDIR /code/

COPY . .

RUN npm config set registry https://registry.npmmirror.com && npm install && npm run build

EXPOSE 3000

CMD ["pm2-runtime", "dist/index.js"]
