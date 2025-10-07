import packageJson from '@package';

export const AppConfig = {
    production: false,
    environment: 'WEB',
    version: packageJson.version,
    BACKEND_URL: 'http://localhost:3333',
};
