FROM node:22-alpine AS build

RUN apk add --no-cache python3 make g++ git

WORKDIR /usr/src/app

COPY .npmrc ./
COPY package.json pnpm-lock.yaml ./

RUN corepack enable && pnpm install --frozen-lockfile

COPY . .

RUN pnpm nx build web --configuration=pwa
RUN pnpm nx build web-backend

FROM node:22-alpine

RUN apk add --no-cache nginx

WORKDIR /opt/iptvnator

ENV PORT=3000
ENV BACKEND_URL=/api
ENV CLIENT_URL=http://localhost:4333

COPY --from=build /usr/src/app/dist/apps/web /usr/share/nginx/html
COPY --from=build /usr/src/app/dist/apps/web-backend ./web-backend
COPY docker/nginx.conf /etc/nginx/http.d/default.conf
COPY docker/docker-entrypoint.sh /usr/local/bin/iptvnator-entrypoint

RUN chmod +x /usr/local/bin/iptvnator-entrypoint

EXPOSE 80

CMD ["iptvnator-entrypoint"]
