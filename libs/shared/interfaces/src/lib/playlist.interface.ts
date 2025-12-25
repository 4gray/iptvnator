/**
 * An interface that describe the possible states of the playlist update/refresh process
 */
export enum PlaylistUpdateState {
    UPDATED,
    IN_PROGRESS,
    NOT_UPDATED,
}

/**
 * Describes playlist interface
 */
export interface Playlist {
    _id: string;
    title: string;
    filename?: string;
    playlist?: any;
    importDate: string;
    lastUsage: string;
    favorites?: string[];
    items?: unknown[];
    header?: unknown;
    count: number;
    url?: string;
    userAgent?: string;
    referrer?: string;
    origin?: string;
    filePath?: string;
    autoRefresh: boolean;
    updateDate?: number;
    updateState?: PlaylistUpdateState;
    position?: number;
    isTemporary?: boolean;
    serverUrl?: string;
    username?: string;
    password?: string;
    macAddress?: string;
    portalUrl?: string;
    recentlyViewed?: any[];
    /** Indicates if this is a full stalker portal URL (e.g., /stalker_portal/c) requiring handshake authentication */
    isFullStalkerPortal?: boolean;
    /** Session token for full stalker portal authentication - persisted for session */
    stalkerToken?: string;
    /** Serial number for stalker portal - generated once and stored for consistency */
    stalkerSerialNumber?: string;
    /** Optional device ID 1 for stalker portal - if not provided, auto-generated from MAC */
    stalkerDeviceId1?: string;
    /** Optional device ID 2 for stalker portal - if not provided, auto-generated from MAC */
    stalkerDeviceId2?: string;
    /** Optional signature 1 for stalker portal - required by some portals for device verification */
    stalkerSignature1?: string;
    /** Optional signature 2 for stalker portal - required by some portals for device verification */
    stalkerSignature2?: string;
    /** Account info from get_profile call */
    stalkerAccountInfo?: {
        login?: string;
        expireDate?: number;
        tariffPlanName?: string;
        status?: number;
    };
}
