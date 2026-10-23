# Matchlight: one image serves the API + agents + WebSocket hub, and the built web app.
# Override NODE_IMAGE to use another registry, e.g. --build-arg NODE_IMAGE=mcr.microsoft.com/azurelinux/base/nodejs:20
ARG NODE_IMAGE=node:22-alpine

FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY overlay-schema/package.json overlay-schema/
COPY simulator/package.json simulator/
COPY pipeline/package.json pipeline/
COPY agents/package.json agents/
COPY api/package.json api/
COPY web/package.json web/
RUN npm ci --no-audit --no-fund
COPY . .
ARG VITE_API_BASE=""
ENV VITE_API_BASE=$VITE_API_BASE
RUN npm run build && npm prune --omit=dev --no-audit --no-fund

FROM ${NODE_IMAGE} AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=8787 WEB_DIST=/app/web/dist
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/api/dist/server.mjs ./api/dist/server.mjs
COPY --from=build /app/web/dist ./web/dist
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:8787/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "api/dist/server.mjs"]
