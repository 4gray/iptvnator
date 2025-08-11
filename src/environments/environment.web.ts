import packageJson from '../../package.json';

export const AppConfig = {
    production: true,
    environment: 'WEB',
    version: packageJson.version,
    BACKEND_URL: 'https://iptvnator-playlist-parser-api.vercel.app',
};
