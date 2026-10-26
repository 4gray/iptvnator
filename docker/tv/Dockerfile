# Build context is a prepared directory containing web-backend/ and these files.
# Reuse the existing self-hosted runtime's Node, nginx and native SQLite addon.
ARG BASE_IMAGE=4gray/iptvnator@sha256:017948eb10ff2a45bea4bb837f645dc6613318773b3f9e53bb360af5605cec66
FROM ${BASE_IMAGE}
COPY web-backend/ /opt/iptvnator/web-backend/
COPY nginx.conf /etc/nginx/http.d/tv.conf.template
COPY start.sh /usr/local/bin/iptvnator-tv-entrypoint
RUN chmod +x /usr/local/bin/iptvnator-tv-entrypoint
ENV IPTVNATOR_STORAGE=none
CMD ["iptvnator-tv-entrypoint"]
