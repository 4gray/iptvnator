import { OidcConfig } from '../app/services/auth/oidc-config.interface';

export const AppConfig = {
    production: false,
    environment: 'LOCAL',
    version: require('../../package.json').version,
    BACKEND_URL: 'https://csiptv-playlist-parser-api.vercel.app',
    OIDC_CONFIG: {
        authority: 'http://localhost:8080/realms/development',
        client_id: 'iptv_clientid',
        redirect_uri: `${window.location.origin}/auth-callback`,
        response_type: 'code',
        scope: 'openid profile email',
        post_logout_redirect_uri: `${window.location.origin}/logout`,
        automaticSilentRenew: true,
        filterProtocolClaims: true,
        loadUserInfo: true,
        silent_redirect_uri: `${window.location.origin}/silent-refresh.html`,
    } as OidcConfig,
};
