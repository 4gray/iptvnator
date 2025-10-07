import packageJson from '@package';

export const AppConfig = {
    production: false,
    environment: 'LOCAL',
    version: packageJson.version,
    BACKEND_URL: 'https://iptvnator-playlist-parser-api.vercel.app',
};
