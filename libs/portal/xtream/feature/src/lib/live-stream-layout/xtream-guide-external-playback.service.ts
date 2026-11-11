import {
    computed,
    DestroyRef,
    effect,
    inject,
    Injectable,
    linkedSignal,
    signal,
    untracked,
} from '@angular/core';
import {
    isLiveExternalPlayerSession,
    PORTAL_EXTERNAL_PLAYBACK,
} from '@iptvnator/portal/shared/util';
import { XtreamStore } from '@iptvnator/portal/xtream/data-access';
import { ParentalLockService } from '@iptvnator/services';
import type {
    EpgProgram,
    ExternalPlayerSession,
    ResolvedPortalPlayback,
} from '@iptvnator/shared/interfaces';
import {
    isXtreamLiveCategoryWithheld,
    XtreamExternalLiveSessions,
    type XtreamLiveSource,
} from './xtream-external-live-sessions.service';
import {
    replaceXtreamQueuedCopy,
    sameXtreamChannelCopy,
    type XtreamLiveChannelItem,
} from './xtream-live-channel-navigation.service';

interface GuideLaunch {
    lockSource: XtreamLiveSource;
    item: XtreamLiveChannelItem;
    archive: EpgProgram | null;
    playback: ResolvedPortalPlayback;
    ended?: () => boolean;
    remote?: boolean;
    onConfirmed?: () => void;
}

type ConfirmedLaunch = GuideLaunch & { session: ExternalPlayerSession };

interface GuidePanel {
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

function hasOpened(
    session: ExternalPlayerSession | null | undefined
): session is ExternalPlayerSession & { status: 'opened' | 'playing' } {
    return (
        !session?.playbackIdle &&
        (session?.status === 'opened' || session?.status === 'playing')
    );
}

/** The live panel follows confirmed playback, independently of browse previews. */
@Injectable()
export class XtreamGuideExternalPlayback {
    private readonly playback = inject(PORTAL_EXTERNAL_PLAYBACK, {
        optional: true,
    });
    private readonly lock = inject(ParentalLockService);
    private readonly sessions = inject(XtreamExternalLiveSessions);
    private readonly store = inject(XtreamStore);
    private readonly destroyRef = inject(DestroyRef);
    private readonly pending = signal<GuideLaunch | undefined>(undefined);
    private panel?: GuidePanel;
    private panelPlayback?: ResolvedPortalPlayback;
    private readonly panelSessionId = signal<string | undefined>(undefined);

    readonly hasSessionUpdates =
        !!this.playback &&
        typeof window.electron?.onExternalPlayerSessionUpdate === 'function';
    private readonly playing = linkedSignal({
        source: () => ({
            playlistId: this.store.currentPlaylist()?.id,
            active: this.playback?.activeSession(),
        }),
        computation: (
            { playlistId, active },
            previous
        ): ConfirmedLaunch | null => {
            if (!playlistId || !this.hasSessionUpdates) return null;
            const prior = previous?.value;
            const activeSource = hasOpened(active)
                ? this.sessions.state(active.id)?.source
                : undefined;
            const owned = activeSource?.playlistId === playlistId;
            this.lock.version();
            const previousSession =
                prior?.lockSource.playlistId === playlistId &&
                prior.session.id !== active?.id
                    ? this.sessions.state(prior.session.id)?.session
                    : undefined;
            const session =
                owned && !isXtreamLiveCategoryWithheld(this.lock, activeSource)
                    ? active
                    : (this.sessions.latestOpened(playlistId, active?.id) ??
                      (owned ? active : previousSession));
            if (!hasOpened(session)) return null;
            const source = this.sessions.state(session.id)?.source;
            if (!source) return null;
            const launch =
                prior?.session.id === session.id && prior.lockSource === source
                    ? prior
                    : this.reattach(source);
            if (!launch) return null;
            return { ...launch, session };
        },
    });

    readonly confirmed = computed(() => {
        this.lock.version();
        const playing = this.playing();
        return playing &&
            !isXtreamLiveCategoryWithheld(this.lock, playing.lockSource)
            ? playing
            : null;
    });

    readonly launching = computed(() => {
        const active = this.playback?.activeSession();
        if (active?.status !== 'launching' || this.playing()) return false;
        const source = this.sessions.state(active.id)?.source;
        this.lock.version();
        return (
            !!source &&
            source.playlistId === this.store.currentPlaylist()?.id &&
            !isXtreamLiveCategoryWithheld(this.lock, source)
        );
    });

    readonly idleStream = computed(() => {
        const active = this.playback?.activeSession();
        const followed = this.panelSessionId();
        const playlistId = this.store.currentPlaylist()?.id;
        this.lock.version();
        return [active?.id, followed].some((id) => {
            const entry = id ? this.sessions.state(id) : undefined;
            return (
                !!entry?.session.playbackIdle &&
                (entry.session.status === 'opened' ||
                    entry.session.status === 'playing') &&
                entry.source.playlistId === playlistId &&
                !isXtreamLiveCategoryWithheld(this.lock, entry.source)
            );
        });
    });

    remoteTuningItem(): XtreamLiveChannelItem | undefined {
        const pending = this.pending();
        return pending?.remote &&
            !pending.ended?.() &&
            pending.lockSource.playlistId ===
                this.store.currentPlaylist()?.id &&
            !isXtreamLiveCategoryWithheld(this.lock, pending.lockSource)
            ? pending.item
            : undefined;
    }

    canRetryUnverifiedStream(): boolean {
        const session = this.confirmed()?.session;
        return (
            session?.player === 'vlc' &&
            (session.playbackUnverified || session.playbackIdle === undefined)
        );
    }

    constructor() {
        effect(() => {
            if (!this.panel?.enabled()) return;
            const active = this.playback?.activeSession();
            const playing = this.confirmed();
            const pending = this.pending();
            const ended = pending?.ended?.();
            untracked(() => {
                const confirmedRequest =
                    pending &&
                    playing?.lockSource === pending.lockSource &&
                    playing.session.mediaLoaded !== false
                        ? pending
                        : undefined;
                if (confirmedRequest || ended) {
                    this.pending.set(undefined);
                }
                if (!playing) return;
                const id = playing.session.id;
                if (
                    !ended &&
                    !confirmedRequest &&
                    this.panelSessionId() === id &&
                    !(active?.id === id && active.restoredFromSessionId)
                )
                    return;
                this.syncPanel(playing);
                confirmedRequest?.onConfirmed?.();
            });
        });
    }

    bind(panel: GuidePanel): void {
        this.panel = panel;
    }

    reset(): void {
        this.pending.set(undefined);
        this.panelPlayback = undefined;
        this.panelSessionId.set(undefined);
    }

    start(
        playback: ResolvedPortalPlayback | null,
        item: XtreamLiveChannelItem,
        archive: EpgProgram | null,
        categoryId: XtreamLiveSource['categoryId'],
        queue?: readonly XtreamLiveChannelItem[],
        remote = false,
        onConfirmed?: () => void
    ): void {
        if (!playback?.streamUrl) return;
        const playlistId = this.store.currentPlaylist()?.id;
        const launch: GuideLaunch | undefined =
            playlistId && this.hasSessionUpdates
                ? {
                      lockSource: {
                          playlistId,
                          categoryId,
                          channel: item,
                          archive,
                          playback,
                          queue,
                      },
                      item,
                      archive,
                      playback,
                      remote,
                      onConfirmed,
                  }
                : undefined;
        this.panelPlayback = playback;
        const lifecycle = launch && this.sessions.begin(launch.lockSource);
        if (launch) launch.ended = lifecycle?.ended;
        this.pending.set(launch);
        const recover = () => {
            if (this.pending() !== launch || this.destroyRef.destroyed) return;
            this.pending.set(undefined);
            const confirmed = this.confirmed();
            if (confirmed) this.syncPanel(confirmed);
        };
        const args = [
            playback.streamUrl,
            playback.title,
            playback.thumbnail,
        ] as const;
        const opening = lifecycle
            ? this.store.openPlayer(
                  ...args,
                  undefined,
                  undefined,
                  lifecycle.launchId
              )
            : this.store.openPlayer(...args);
        void Promise.resolve(opening).then(
            (session) => {
                lifecycle?.finish(session);
                if (
                    !session ||
                    !isLiveExternalPlayerSession(session) ||
                    session.status === 'error'
                )
                    recover();
            },
            () => {
                lifecycle?.finish();
                recover();
            }
        );
    }

    replacePendingCopy(
        item: XtreamLiveChannelItem,
        category: () => XtreamLiveSource['categoryId'],
        queue: readonly XtreamLiveChannelItem[],
        onConfirmed?: () => void
    ): boolean {
        const pending = this.pending();
        if (
            !pending ||
            pending.lockSource.playlistId !==
                this.store.currentPlaylist()?.id ||
            pending.ended?.() ||
            pending.archive ||
            pending.item.xtream_id !== item.xtream_id
        )
            return false;
        if (onConfirmed) pending.onConfirmed = onConfirmed;
        if (!sameXtreamChannelCopy(pending.item, item)) {
            pending.item = item;
            pending.lockSource.categoryId = category();
            pending.lockSource.channel = item;
            pending.lockSource.queue = queue;
            if (this.panel?.current() === pending.playback)
                this.panel.select(item);
        }
        return true;
    }

    replaceConfirmedCopy(
        item: XtreamLiveChannelItem,
        categoryId: XtreamLiveSource['categoryId']
    ): void {
        const playing = this.confirmed();
        if (!playing) return;
        const queue = replaceXtreamQueuedCopy(
            playing.lockSource.queue ?? [],
            item
        );
        const copy = {
            ...playing,
            item,
            lockSource: {
                ...playing.lockSource,
                categoryId,
                channel: item,
                queue,
            },
        };
        this.playing.set(copy);
        this.sessions.update(playing.session, copy.lockSource);
        this.syncPanel(copy);
    }

    resolveCategory(
        url: string,
        item: XtreamLiveChannelItem,
        categoryId: number
    ): void {
        for (const launch of [this.pending(), this.playing()])
            if (launch?.playback.streamUrl === url && launch.item === item)
                launch.lockSource.categoryId = categoryId;
    }

    restoreConfirmedPanel(): boolean {
        const confirmed = this.confirmed();
        const current = this.panel?.current();
        if (!confirmed || (current && current !== this.panelPlayback))
            return false;
        this.syncPanel(confirmed);
        return true;
    }

    private reattach(source: XtreamLiveSource): GuideLaunch | undefined {
        const item = source.channel;
        if (!source.playback || !item) return;
        return {
            lockSource: source,
            item,
            archive: source.archive ?? null,
            playback: source.playback,
        };
    }

    private syncPanel(launch: ConfirmedLaunch): void {
        const panel = this.panel;
        if (!panel) return;
        this.panelSessionId.set(launch.session.id);
        const current = panel.current();
        panel.capture(launch.item, launch.lockSource.queue ?? [launch.item]);
        if (current && current !== this.panelPlayback) return;
        if (current === launch.playback && panel.currentItem() === launch.item)
            return;
        this.panelPlayback = launch.playback;
        panel.restore(launch);
    }
}
