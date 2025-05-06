#!/bin/sh

# Replace backend URL
sed -i "s#http://localhost:3333#$BACKEND_URL#g" /usr/share/nginx/html/*.js

# Escape secret key only if it's set
if [ -n "$SECRET_KEY" ]; then
    sed -i "s#YOUR-SECRET-KEY#$SECRET_KEY#g" /usr/share/nginx/html/*.js
fi

# Replace external DB flag if enabled
if [ "$ENABLE_EXTERNAL_DB" = "true" ]; then
    sed -i "s#ENABLE_EXTERNAL_DB:!1#ENABLE_EXTERNAL_DB:!0#g" /usr/share/nginx/html/*.js
fi

# Start nginx
exec nginx -g 'daemon off;'