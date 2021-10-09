FROM node:lts-bullseye

RUN set -ex \
  && apt-get update\
  && apt-get -yf upgrade\
  && apt-get -yf autoremove\
  && apt-get clean

WORKDIR /opt/MetaNetwork/Worker-Hexo
COPY . .
RUN yarn install --frozen-lockfile && yarn run build

ENV NODE_ENV production
CMD yarn run start:prod
