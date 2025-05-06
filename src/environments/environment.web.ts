export const AppConfig = {
    production: false,
    environment: 'WEB',
    version: require('../../package.json').version,
    BACKEND_URL: 'http://localhost:3333',
    SECRET_KEY: 'YOUR-SECRET-KEY',
    ENABLE_EXTERNAL_DB: false,
};
