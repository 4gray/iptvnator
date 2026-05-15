# Self-hosted version of IPTVnator

You can deploy and run the PWA version of IPTVnator on your own machine with `docker-compose` using the following command:

    $ cd docker
    $ docker-compose up -d

This command will launch the frontend and backend applications. By default, the application will be available at: http://localhost:4333/. The ports can be configured in the `docker-compose.yml` file.

The web backend proxy accepts only `http` and `https` provider URLs. The PWA first registers provider URLs through `/provider-targets`, then uses the returned `targetId` for playlist, Xtream, and Stalker proxy calls. The backend blocks loopback, private, link-local, and reserved network targets by default to avoid exposing the self-hosted server as a generic internal-network fetcher. If you intentionally need to test against local mock servers or LAN-only IPTV sources, set `IPTVNATOR_PROXY_ALLOW_PRIVATE_NETWORKS=1` on the backend container and avoid exposing that instance to untrusted users.

For providers that use private certificate authorities, keep TLS validation enabled and pass the CA bundle to Node with `NODE_EXTRA_CA_CERTS=/path/to/ca.pem`.

## Build frontend

    $ docker build -t 4gray/iptvnator -f docker/Dockerfile .

## Build backend

You can find the backend app with all instructions in a separate GitHub repository - https://github.com/4gray/iptvnator-backend
