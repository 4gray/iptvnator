import { InjectionToken } from '@angular/core';
import type { ServerInstanceInfo } from '@iptvnator/shared/interfaces';

export interface ServerStorageConfig {
    readonly instance: ServerInstanceInfo;
    /** Backend base URL as the PWA resolves it, e.g. `/api`. */
    readonly baseUrl: string;
    /**
     * The start-up probe got no answer and the instance came from this
     * browser's memory of the server: the page reloads once it answers.
     */
    readonly startedOffline?: boolean;
}

export const SERVER_STORAGE_CONFIG = new InjectionToken<ServerStorageConfig>(
    'SERVER_STORAGE_CONFIG'
);
