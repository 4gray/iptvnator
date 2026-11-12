import { InjectionToken, Signal } from '@angular/core';
import { ExternalPlayerSession } from '@iptvnator/shared/interfaces';
import type { Observable } from 'rxjs';

export interface PortalExternalPlayback {
    readonly activeSession: Signal<ExternalPlayerSession | null>;
    readonly visibleSession: Signal<ExternalPlayerSession | null>;
    readonly stopRequested?: Observable<string>;
    dismissActiveSession(): void;
    restoreDismissedSession?(sessionId: string): void;
    restoreDisplacedSession?(
        session: ExternalPlayerSession,
        displacedId: string
    ): void;
    closeSession(
        session: ExternalPlayerSession | null | undefined,
        userRequested?: boolean
    ): Promise<void>;
}

export const PORTAL_EXTERNAL_PLAYBACK =
    new InjectionToken<PortalExternalPlayback>('PORTAL_EXTERNAL_PLAYBACK');
