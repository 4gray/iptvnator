// The file contents for the current environment will overwrite these during build.
// The build system defaults to the dev environment which uses `index.ts`, but if you do
// `ng build --env=prod` then `index.prod.ts` will be used instead.
// The list of which env maps to which file can be found in `.angular-cli.json`.

import { OidcConfig } from '../app/services/auth/oidc-config.interface';

export const AppConfig = {
    production: false,
    environment: 'DEV',
    version: require('../../package.json').version,
    BACKEND_URL: 'http://localhost:3000',
    OIDC_CONFIG: {
        authority: 'http://localhost:8080/realms/development',
        client_id: 'iptv_clientid',
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
