FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000 UPLOAD_DIR=/data/uploads
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY shared ./shared
COPY public ./public
RUN mkdir -p /data/uploads && chown -R node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000
CMD ["node", "server/index.js"]
