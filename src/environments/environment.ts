export const AppConfig = {
    production: false,
    environment: 'LOCAL',
    version: require('../../package.json').version,
    BACKEND_URL: 'https://iptvnator-playlist-parser-api.vercel.app',
    SECRET_KEY: 'YOUR-SECRET-KEY',
    ENABLE_EXTERNAL_DB: false,
};
