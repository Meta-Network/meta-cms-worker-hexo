FROM ghcr.io/biscuittin/node:14-impish AS builder
RUN set -ex \
  && apt-get update\
  && apt-get -yf upgrade\
  && apt-get -yf autoremove\
  && apt-get clean
WORKDIR /opt/MetaNetwork/Worker-Hexo
COPY . .
RUN yarn install --frozen-lockfile && yarn run build

FROM node:lts-alpine as runner
WORKDIR /opt/MetaNetwork/Worker-Hexo
COPY --from=builder /opt/MetaNetwork/Worker-Hexo/dist ./dist
ENV NODE_ENV production
CMD node --enable-source-maps dist/main.js
