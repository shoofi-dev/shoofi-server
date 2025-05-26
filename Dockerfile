FROM node:16

ENV NODE_VERSION 16.0.0

WORKDIR /var/expressCart

COPY lib/ /var/expressCart/lib/
COPY bin/ /var/expressCart/bin/
COPY config/ /var/expressCart/config/
COPY public/ /var/expressCart/public/
COPY utils/ /var/expressCart/utils/
COPY routes/ /var/expressCart/routes/
COPY consts/ /var/expressCart/consts/
COPY services/ /var/expressCart/services/

COPY app.js /var/expressCart/
COPY package.json /var/expressCart/
COPY deploy.js /var/expressCart/
COPY serviceAccountKey-sari-apps.json /var/expressCart/

RUN npm install

VOLUME /var/expressCart/data

EXPOSE 1111
ENTRYPOINT ["npm", "start"]
