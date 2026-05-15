import { InjectionToken, Signal } from '@angular/core';
import { ExternalPlayerSession } from '@iptvnator/shared/interfaces';

export interface PortalExternalPlayback {
    readonly activeSession: Signal<ExternalPlayerSession | null>;
    readonly visibleSession: Signal<ExternalPlayerSession | null>;
    dismissActiveSession(): void;
    closeSession(
        session: ExternalPlayerSession | null | undefined
    ): Promise<void>;
}

export const PORTAL_EXTERNAL_PLAYBACK =
    new InjectionToken<PortalExternalPlayback>('PORTAL_EXTERNAL_PLAYBACK');
