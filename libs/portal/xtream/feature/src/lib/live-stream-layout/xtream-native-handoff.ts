import type { WritableSignal } from '@angular/core';
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
import {
    replaceXtreamQueuedCopy,
    type XtreamLiveChannelItem,
} from './xtream-live-channel-navigation.service';

export type GuideLaunchOutcome = false | 'ended' | 'failed' | 'retryable';

export function createXtreamLaunchCompletion() {
    let dispatched = false;
    let observed = false;
    let settle!: () => void;
    const closed = new Promise<void>((resolve) => (settle = resolve));
    return {
        dispatch: () => (dispatched = true),
        observe: (session: ExternalPlayerSession) => {
            observed = true;
            if (!isLiveExternalPlayerSession(session)) settle();
        },
        finish: (session?: ExternalPlayerSession | void) => {
            if (!session && !observed) settle();
        },
        wait: () => (dispatched ? closed : undefined),
    };
}

export type XtreamOwnedLaunch = {
    source: XtreamLiveSource;
    ended: WritableSignal<GuideLaunchOutcome>;
    completion: ReturnType<typeof createXtreamLaunchCompletion>;
    retired?: boolean;
    cancelled?: boolean;
    opened?: boolean;
    restoreSessionId?: string;
};

export function cancelXtreamLaunch(
    launch: XtreamOwnedLaunch,
    keep?: { channelId: number; sessionId: string }
): boolean {
    const { source } = launch;
    if (
        launch.retired ||
        launch.opened ||
        !source.channel ||
        (source.channel.xtream_id === keep?.channelId && !source.archive)
    )
        return false;
    launch.cancelled = true;
    launch.restoreSessionId = keep?.sessionId;
    launch.ended.set('ended');
    return true;
}

export interface GuideLaunch {
    lockSource: XtreamLiveSource;
    item: XtreamLiveChannelItem;
    archive: EpgProgram | null;
    playback: ResolvedPortalPlayback;
    ended?: () => GuideLaunchOutcome;
    retry?: boolean;
    remote?: boolean;
    onConfirmed?: () => void;
}

export type ConfirmedLaunch = GuideLaunch & { session: ExternalPlayerSession };

export function withConfirmedChannelCopy(
    playing: ConfirmedLaunch,
    item: XtreamLiveChannelItem,
    categoryId: XtreamLiveSource['categoryId']
): ConfirmedLaunch {
    return {
        ...playing,
        item,
        lockSource: {
            ...playing.lockSource,
            categoryId,
            channel: item,
            queue: replaceXtreamQueuedCopy(
                playing.lockSource.queue ?? [],
                item
            ),
        },
    };
}

export interface GuidePanel {
    enabled(): boolean;
    cancelPendingRequest(): void;
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
        ) => boolean,
        private readonly pendingStop?: (id: string) => Promise<void> | undefined
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
        return (
            id !== undefined &&
            (this.stopping.has(id) || !!this.pendingStop?.(id))
        );
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
                const userStop = this.pendingStop?.(entry.session.id);
                if (pending) stopped.push(pending);
                if (userStop) stopped.push(userStop);
                if (
                    !pending &&
                    !userStop &&
                    this.needsClose(entry, source, player)
                )
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
