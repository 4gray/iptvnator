import packageJson from '../../package.json';

export const AppConfig = {
    production: true,
    environment: 'PROD',
    version: packageJson.version,
    BACKEND_URL: 'http://localhost:3333/api',
};
