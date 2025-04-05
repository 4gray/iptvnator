# Stage 1 - build environment
FROM node:22-alpine AS build

RUN apk add --no-cache python3 make g++ git

# Create app directory
WORKDIR /usr/src/app

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

# Copy artifacts and nginx.conf
COPY --from=build /usr/src/app/dist/browser /usr/share/nginx/html
COPY --from=build /usr/src/app/docker/nginx.conf /etc/nginx/conf.d/default.conf

# Copy the entrypoint script
COPY docker/entrypoint.sh /usr/bin/entrypoint.sh

# Make the script executable
RUN chmod +x /usr/bin/entrypoint.sh

# Use the script as the entry point
CMD ["/usr/bin/entrypoint.sh"]