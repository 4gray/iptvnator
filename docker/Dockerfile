# Stage 1 - build environment
FROM node:18-alpine AS build

RUN apk add --no-cache python3 make g++ git

# Create app directory
WORKDIR /usr/src/app

# Swtich to node user
#RUN chown node:node ./
#USER node

COPY .npmrc ./
COPY package*.json ./

# Install app dependencies
RUN npm ci 

# Copy all required files
COPY . .

# Build the application
RUN npm run build:web

# Stage 2 - the production environment
FROM nginx:stable-alpine

# Copy artifacts and nignx.conf
COPY --from=build /usr/src/app/dist/ /usr/share/nginx/html
COPY --from=build /usr/src/app/docker/nginx.conf /etc/nginx/conf.d/default.conf

CMD sed -i "s#http://localhost:3333#$BACKEND_URL#g" /usr/share/nginx/html/main.*.js && nginx -g 'daemon off;'