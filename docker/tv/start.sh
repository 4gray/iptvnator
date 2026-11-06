#!/bin/sh
set -eu
: "${LIBRARY_UPSTREAM:?Set the existing self-hosted backend URL, including /api}"
: "${TV_WEB_ORIGIN:?Set the browser origin for this container}"
# Only these deployment-owned variables expand here. The base entrypoint expands PORT.
envsubst '${LIBRARY_UPSTREAM} ${TV_WEB_ORIGIN}' \
    < /etc/nginx/http.d/tv.conf.template \
    > /etc/nginx/http.d/default.conf.template
exec iptvnator-entrypoint
