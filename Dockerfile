# MONOHA Sourcing International — public website.
# DATA_DIR must be a persistent volume (Coolify: mount at /data) so
# enquiries and attachments survive redeploys.
FROM node:22-alpine
RUN apk add --no-cache tini
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
ENV DATA_DIR=/data
ENV NODE_ENV=production
ENV PORT=3000
RUN mkdir -p /data && chown -R node:node /data /app
USER node
EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
