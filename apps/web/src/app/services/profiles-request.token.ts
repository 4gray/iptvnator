import { InjectionToken } from '@angular/core';
import { requestSourceServer } from '@iptvnator/services/source-sync';
import type {
    SourceServerRequest,
    SourceServerResponse,
} from '@iptvnator/shared/interfaces';

/** The server transport the profiles runtime uses; tests replace it. */
export const PROFILES_REQUEST = new InjectionToken<
    (request: SourceServerRequest) => Promise<SourceServerResponse>
>('PROFILES_REQUEST', {
    providedIn: 'root',
    factory: () => requestSourceServer,
});
