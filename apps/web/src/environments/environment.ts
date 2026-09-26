import { version as appVersion } from '@package';

export const AppConfig = {
    production: false,
    environment: 'LOCAL',
    version: appVersion,
    BACKEND_URL: 'http://localhost:3000',
};
