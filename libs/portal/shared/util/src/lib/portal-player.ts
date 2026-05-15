import { InjectionToken } from '@angular/core';
import {
    ExternalPlayerSession,
    ResolvedPortalPlayback,
} from '@iptvnator/shared/interfaces';
import type { ExternalPlayerName } from '@iptvnator/shared/interfaces';

export interface PortalPlayer {
    isEmbeddedPlayer(): boolean;
    openPlayer(
        streamUrl: string,
        title: string,
        thumbnail?: string | null,
        hideExternalInfoDialog?: boolean,
        isLiveContent?: boolean,
        userAgent?: string,
        referer?: string,
        origin?: string,
        contentInfo?: unknown,
        startTime?: number,
        headers?: Record<string, string>
    ): Promise<ExternalPlayerSession | void>;
    openResolvedPlayback(
        playback: ResolvedPortalPlayback,
        hideExternalInfoDialog?: boolean
    ): Promise<ExternalPlayerSession | void>;
    openExternalPlayback(
        playback: ResolvedPortalPlayback,
        player: ExternalPlayerName
    ): Promise<ExternalPlayerSession | void>;
}

export const PORTAL_PLAYER = new InjectionToken<PortalPlayer>(
    'PORTAL_PLAYER'
);
