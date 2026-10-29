export const SOURCE_SYNC_CAPABILITY = 'sources-v1';

export interface SourceDefinition {
    id: string;
    title: string;
    kind: 'm3u-url' | 'm3u-text' | 'xtream' | 'stalker';
    url?: string;
    serverUrl?: string;
    portalUrl?: string;
    username?: string;
    password?: string;
    macAddress?: string;
    userAgent?: string;
    referrer?: string;
    origin?: string;
    isFullStalkerPortal?: boolean;
    stalkerSerialNumber?: string;
    stalkerDeviceId1?: string;
    stalkerDeviceId2?: string;
    stalkerSignature1?: string;
    stalkerSignature2?: string;
    rawM3u?: string;
}

export interface SourceInventoryEntry {
    source: SourceDefinition;
    revision: string;
}

export interface SourceInventory {
    entries: SourceInventoryEntry[];
}

/** Persisted selection contains no access token. */
export interface SourceServerConnection {
    apiUrl: string;
    instanceId: string;
}

/** Narrow IPC surface; paths and arbitrary headers are never caller-supplied. */
export interface SourceServerRequest {
    operation:
        'instance' | 'list' | 'get' | 'create' | 'update' | 'delete' | 'clear';
    id?: string;
    source?: SourceDefinition;
    revision?: string;
}

export interface SourceServerResponse {
    status: number;
    etag?: string;
    body?: unknown;
}
