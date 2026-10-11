import { InjectionToken } from '@angular/core';
import type { ServerInstanceInfo } from '@iptvnator/shared/interfaces';

export interface ServerStorageConfig {
    readonly instance: ServerInstanceInfo;
    /** Backend base URL as the PWA resolves it, e.g. `/api`. */
    readonly baseUrl: string;
}

export const SERVER_STORAGE_CONFIG = new InjectionToken<ServerStorageConfig>(
    'SERVER_STORAGE_CONFIG'
);
