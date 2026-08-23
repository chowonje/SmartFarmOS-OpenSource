FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/admin/package.json apps/admin/package.json
COPY apps/pwa/package.json apps/pwa/package.json
COPY services/api/package.json services/api/package.json
COPY services/edge/package.json services/edge/package.json
COPY tools/device-simulator/package.json tools/device-simulator/package.json
COPY tools/local-demo/package.json tools/local-demo/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/module-sdk/package.json packages/module-sdk/package.json

RUN npm ci

COPY apps/admin apps/admin
COPY apps/pwa apps/pwa
COPY services/api services/api
COPY services/edge services/edge
COPY tools/device-simulator tools/device-simulator
COPY tools/local-demo tools/local-demo
COPY packages/contracts packages/contracts
COPY packages/module-sdk packages/module-sdk
COPY scripts scripts

RUN npm run build

FROM caddy:2.10-alpine

RUN apk add --no-cache nodejs npm

WORKDIR /app

COPY --from=build /app /app
COPY deploy/cloud-pilot/Caddyfile /etc/caddy/Caddyfile
COPY deploy/cloud-pilot/entrypoint.sh /usr/local/bin/smartfarm-cloud-pilot-entrypoint

RUN chmod +x /usr/local/bin/smartfarm-cloud-pilot-entrypoint

EXPOSE 80 443

ENTRYPOINT ["/usr/local/bin/smartfarm-cloud-pilot-entrypoint"]
