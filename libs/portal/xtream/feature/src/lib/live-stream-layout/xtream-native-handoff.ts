import { isLiveExternalPlayerSession } from '@iptvnator/portal/shared/util';
import type {
    EpgProgram,
    ExternalPlayerSession,
    ResolvedPortalPlayback,
} from '@iptvnator/shared/interfaces';
import type {
    XtreamLiveOwner,
    XtreamLiveSource,
} from './xtream-external-live-sessions.service';
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

type OwnedSession = {
    session: ExternalPlayerSession;
    source: XtreamLiveSource;
};

type ReadySession = {
    ready: Promise<string | undefined>;
    resolve(id?: string): void;
    id?: string;
    finished?: boolean;
};

/** Orders exact closes before the newest tune, even before native IPC publishes its session. */
export class XtreamNativeHandoff {
    private readonly waiting = new Map<XtreamLiveSource, ReadySession>();
    private readonly stopping = new Map<string, Promise<void>>();

    constructor(
        private readonly sameOwner: (
            left: XtreamLiveOwner,
            right: XtreamLiveOwner
        ) => boolean
    ) {}

    dispatch(source: XtreamLiveSource): void {
        let resolve!: ReadySession['resolve'];
        const ready = new Promise<string | undefined>((done) => {
            resolve = done;
        });
        this.waiting.set(source, { ready, resolve });
    }

    observe(source: XtreamLiveSource, session?: ExternalPlayerSession): void {
        const pending = this.waiting.get(source);
        if (
            !pending ||
            (isLiveExternalPlayerSession(session) && !session.canClose)
        )
            return;
        pending.id = session?.id;
        pending.resolve(pending.id);
        if (pending.finished) this.waiting.delete(source);
    }

    finish(source: XtreamLiveSource, session?: ExternalPlayerSession): void {
        const pending = this.waiting.get(source);
        if (!pending) return;
        if (isLiveExternalPlayerSession(session) && !session.canClose) {
            pending.finished = true;
            return;
        }
        pending.resolve(session?.id);
        this.waiting.delete(source);
    }

    isStopping(id: string | undefined): boolean {
        return id !== undefined && this.stopping.has(id);
    }

    beforeTune(
        source: XtreamLiveSource,
        player: string | undefined,
        ids: readonly (string | undefined)[],
        lookup: (id: string) => OwnedSession | undefined,
        isCurrent: () => boolean
    ): Promise<void> | undefined {
        const stop = (
            candidates: readonly (string | undefined)[]
        ): Promise<void> | undefined => {
            const stopped: Promise<void>[] = [];
            for (const id of new Set(candidates)) {
                const entry = id ? lookup(id) : undefined;
                if (!entry || !this.sameOwner(entry.source, source)) continue;
                const pending = this.stopping.get(entry.session.id);
                if (pending) stopped.push(pending);
                else if (this.needsClose(entry, source, player))
                    stopped.push(this.stop(entry.session.id));
            }
            return stopped.length <= 1
                ? stopped[0]
                : Promise.all(stopped).then(() => undefined);
        };
        const candidates = [...ids];
        const waiting: Promise<string | undefined>[] = [];
        const canReuse = ids.some((id) => {
            const entry = id ? lookup(id) : undefined;
            return (
                !!entry &&
                this.sameOwner(entry.source, source) &&
                entry.session.reuseAvailable &&
                entry.session.player === player &&
                !this.isStopping(id)
            );
        });
        if (player && !canReuse)
            this.waiting.forEach(({ ready, id }, prior) => {
                if (!this.sameOwner(prior, source)) return;
                if (id) candidates.push(id);
                else waiting.push(ready);
            });
        const immediate = stop(candidates);
        if (!waiting.length) return immediate;
        const afterDispatch = Promise.all(waiting).then((ids) =>
            isCurrent() ? stop(ids) : undefined
        );
        return immediate
            ? Promise.all([immediate, afterDispatch]).then(() => undefined)
            : afterDispatch;
    }

    private needsClose(
        { session, source: prior }: OwnedSession,
        source: XtreamLiveSource,
        player?: string
    ): boolean {
        if (
            !session.canClose ||
            (session.player !== 'mpv' && session.player !== 'vlc')
        )
            return false;
        if (
            source.channel?.xtream_id === prior.channel?.xtream_id &&
            source.playback?.streamUrl === session.streamUrl
        )
            return (
                session.mediaLoaded === false ||
                !!session.playbackUnverified ||
                !!session.playbackIdle ||
                (session.status !== 'opened' && session.status !== 'playing')
            );
        return (
            !!player && !(session.reuseAvailable && session.player === player)
        );
    }

    private stop(id: string): Promise<void> {
        const close = window.electron?.closeExternalPlayerSession;
        if (!close)
            return Promise.reject(new Error('Exact player close unavailable'));
        const stopping = close(id, true)
            .then((result) => {
                if (isLiveExternalPlayerSession(result))
                    throw new Error('Previous player is still open');
            })
            .finally(() => this.stopping.delete(id));
        this.stopping.set(id, stopping);
        return stopping;
    }
}
