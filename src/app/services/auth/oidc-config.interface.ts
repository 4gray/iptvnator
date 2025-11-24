/**
 * OIDC Configuration Interface
 */
export interface OidcConfig {
    /** The URL of the OIDC provider */
    authority: string;
    /** The client ID registered with the OIDC provider */
    client_id: string;
    /** The redirect URI after successful authentication */
    redirect_uri: string;
    /** The response type (usually 'code' for authorization code flow) */
    response_type?: string;
    /** The scopes to request */
    scope?: string;
    /** The post logout redirect URI */
    post_logout_redirect_uri?: string;
    /** Whether to use silent refresh */
    automaticSilentRenew?: boolean;
    /** Whether to filter protocol claims */
    filterProtocolClaims?: boolean;
    /** Whether to load user info */
    loadUserInfo?: boolean;
    /** The silent redirect URI for token refresh */
    silent_redirect_uri?: string;
}



