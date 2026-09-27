FROM louislam/uptime-kuma:latest

USER root

WORKDIR /opt/status-gateway

COPY gateway/package.json ./
RUN npm install --omit=dev

COPY gateway/src ./src
COPY gateway/public ./public
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh \
  && chown -R node:node /opt/status-gateway

ENV NODE_ENV=production \
    PORT=8080 \
    KUMA_PORT=3001 \
    BASE_URL=https://status.processpro.io \
    ALLOWED_EMAIL_DOMAINS=processpro.io,processpro.com

EXPOSE 8080

USER node

ENTRYPOINT ["/usr/bin/dumb-init", "--", "/entrypoint.sh"]
