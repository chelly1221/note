FROM node:22.23.2-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY dist-api/server.mjs ./server.mjs
COPY dist/client ./web
USER 1001:1001
EXPOSE 8787
CMD ["node", "server.mjs"]
