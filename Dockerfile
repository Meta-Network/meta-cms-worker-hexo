FROM ghcr.io/biscuittin/node:14-impish AS builder
WORKDIR /opt/MetaNetwork/Worker-Hexo
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile
COPY . .
RUN yarn run build

FROM node:14-alpine3.14
WORKDIR /opt/MetaNetwork/Worker-Hexo
COPY --from=builder /opt/MetaNetwork/Worker-Hexo/dist dist
CMD ["--enable-source-maps","dist/main.js"]
