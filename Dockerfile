# Zoza Family's server and website in one machine, plus the Cloudflare tunnel
# that serves eth.zoza.world. Keys come from Fly secrets, never the image.
FROM node:24-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
 && curl -fsSL -o /usr/local/bin/cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 \
 && chmod +x /usr/local/bin/cloudflared \
 && apt-get purge -y curl && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/package-lock.json server/
COPY web/package.json web/package-lock.json web/
RUN npm ci --omit=dev && (cd server && npm ci --omit=dev) && (cd web && npm ci)
COPY shared shared
COPY deployments deployments
COPY server server
COPY web web
RUN cd web && npx vite build --logLevel warn && rm -rf node_modules
COPY deploy deploy
ENV PORT=8790
CMD ["bash", "deploy/start.sh"]
