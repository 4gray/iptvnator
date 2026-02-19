# Stage 1 - build environment
FROM node:22-alpine AS build

RUN apk add --no-cache python3 make g++ git

# Create app directory
WORKDIR /usr/src/app

# Swtich to node user
#RUN chown node:node ./
#USER node

COPY .npmrc ./
COPY package.json pnpm-lock.yaml ./

# Install app dependencies
RUN corepack enable && pnpm install --frozen-lockfile

# Copy all required files
COPY . .

# Build the application
RUN pnpm run build:web

# Stage 2 - the production environment
FROM nginx:stable-alpine

# Copy artifacts and nignx.conf
COPY --from=build /usr/src/app/dist/browser /usr/share/nginx/html
COPY --from=build /usr/src/app/docker/nginx.conf /etc/nginx/conf.d/default.conf

CMD sed -i "s#http://localhost:3333#$BACKEND_URL#g" /usr/share/nginx/html/main.js && nginx -g 'daemon off;'
