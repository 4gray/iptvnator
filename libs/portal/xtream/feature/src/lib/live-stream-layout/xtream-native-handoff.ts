import { isLiveExternalPlayerSession } from '@iptvnator/portal/shared/util';
import type {
    EpgProgram,
    ExternalPlayerSession,
    ResolvedPortalPlayback,
} from '@iptvnator/shared/interfaces';
import type { XtreamLiveSource } from './xtream-external-live-sessions.service';
import type { XtreamLiveChannelItem } from './xtream-live-channel-navigation.service';

export interface GuideLaunch {
    lockSource: XtreamLiveSource;
    item: XtreamLiveChannelItem;
    archive: EpgProgram | null;
    playback: ResolvedPortalPlayback;
    ended?: () => false | 'ended' | 'failed';
    retry?: boolean;
    remote?: boolean;
    onConfirmed?: () => void;
}

export type ConfirmedLaunch = GuideLaunch & { session: ExternalPlayerSession };

export interface GuidePanel {
    enabled(): boolean;
    current(): ResolvedPortalPlayback | null;
    currentItem(): XtreamLiveChannelItem | null;
    select(item: XtreamLiveChannelItem): void;
    restore(launch: GuideLaunch): void;
    capture(
        item: XtreamLiveChannelItem,
        queue: readonly XtreamLiveChannelItem[]
    ): void;
}

export type OwnedSession = {
    session: ExternalPlayerSession;
    channelId?: number;
};

export function closeBeforeXtreamTune(
    owned: readonly OwnedSession[],
    channelId: number | undefined,
    streamUrl: string | undefined,
    replaceWith?: string
): Promise<void> | undefined {
    const closing = owned.filter(({ session, channelId: priorChannel }) => {
        if (
            !session.canClose ||
            (session.player !== 'mpv' && session.player !== 'vlc')
        )
            return false;
        if (channelId === priorChannel && streamUrl === session.streamUrl)
            return (
                session.mediaLoaded === false ||
                !!session.playbackUnverified ||
                !!session.playbackIdle ||
                (session.status !== 'opened' && session.status !== 'playing')
            );
        return (
            !!replaceWith &&
            !(session.reuseAvailable && session.player === replaceWith)
        );
    });
    if (!closing.length) return undefined;
    const close = window.electron?.closeExternalPlayerSession;
    if (!close)
        return Promise.reject(new Error('Exact player close unavailable'));
    const stopped = closing.map(({ session }) =>
        close(session.id, true).then((result) => {
            if (isLiveExternalPlayerSession(result))
                throw new Error('Previous player is still open');
        })
    );
    return stopped.length === 1
        ? stopped[0]
        : Promise.all(stopped).then(() => undefined);
}
