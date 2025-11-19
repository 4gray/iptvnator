import { OidcConfig } from '../app/services/auth/oidc-config.interface';

export const AppConfig = {
    production: false,
    environment: 'WEB',
    version: require('../../package.json').version,
    BACKEND_URL: 'http://localhost:3333',
    OIDC_CONFIG: {
        authority: 'https://your-oidc-provider.com',
        client_id: 'your-client-id',
        redirect_uri: `${window.location.origin}/auth-callback`,
        response_type: 'code',
        scope: 'openid profile email',
        post_logout_redirect_uri: `${window.location.origin}/`,
        automaticSilentRenew: true,
        filterProtocolClaims: true,
        loadUserInfo: true,
        silent_redirect_uri: `${window.location.origin}/silent-refresh.html`,
    } as OidcConfig,
};
