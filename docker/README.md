# Self-hosted version of Ruvo Player

You can deploy and run the PWA version of Ruvo Player on your own machine with `docker-compose` using the following command:

    $ cd docker
    $ docker-compose up -d

This command will launch the frontend and backend applications. By default, the application will be available at: http://localhost:4333/. The ports can be configured in the `docker-compose.yml` file.

## Build frontend

    $ docker build -t ruvoplay/ruvo-player -f docker/Dockerfile .

## Build backend

You can find the backend app with all instructions in a separate GitHub repository - https://github.com/ruvoplay/ruvo-player-backend
