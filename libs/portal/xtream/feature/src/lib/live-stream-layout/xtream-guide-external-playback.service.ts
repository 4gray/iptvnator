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
    captureNavigation?: () => void;
    ended?: () => boolean;
    remote?: boolean;
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
    private readonly requests = new Map<string, GuideLaunch>();
    private readonly pending = signal<GuideLaunch | undefined>(undefined);
    private panel?: GuidePanel;
    private panelPlayback?: ResolvedPortalPlayback;
    private panelSessionId?: string;

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
            const owned =
                hasOpened(active) &&
                this.sessions.state(active.id)?.source.playlistId ===
                    playlistId;
            const previousSession =
                prior?.lockSource.playlistId === playlistId &&
                prior.session.id !== active?.id
                    ? this.sessions.state(prior.session.id)?.session
                    : undefined;
            const session = owned
                ? active
                : (this.sessions.latestOpened(playlistId, active?.id) ??
                  previousSession);
            if (!hasOpened(session)) return null;
            const source = this.sessions.state(session.id)?.source;
            if (!source) return null;
            const requested = this.requests.get(session.streamUrl);
            const launch =
                prior?.session.id === session.id && prior.lockSource === source
                    ? prior
                    : requested?.lockSource === source
                      ? requested
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
        if (!active?.playbackIdle) return false;
        const source = this.sessions.state(active.id)?.source;
        this.lock.version();
        return (
            !!source &&
            source.playlistId === this.store.currentPlaylist()?.id &&
            !isXtreamLiveCategoryWithheld(this.lock, source)
        );
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
        return session?.player === 'vlc' && session.playbackIdle === undefined;
    }

    constructor() {
        effect(() => {
            if (!this.panel?.enabled()) return;
            const active = this.playback?.activeSession();
            const playing = this.confirmed();
            const pending = this.pending();
            const ended = pending?.ended?.();
            untracked(() => {
                if (pending && playing?.lockSource === pending.lockSource) {
                    this.requests.clear();
                    this.requests.set(playing.session.streamUrl, pending);
                    this.pending.set(undefined);
                } else if (ended) {
                    this.pending.set(undefined);
                }
                if (!playing) return;
                const id = playing.session.id;
                if (
                    !ended &&
                    this.panelSessionId === id &&
                    !(active?.id === id && active.restoredFromSessionId)
                )
                    return;
                this.panelSessionId = id;
                this.syncPanel(playing);
            });
        });
    }

    bind(panel: GuidePanel): void {
        this.panel = panel;
    }

    reset(): void {
        this.requests.clear();
        this.pending.set(undefined);
        this.panelPlayback = undefined;
        this.panelSessionId = undefined;
    }

    start(
        playback: ResolvedPortalPlayback | null,
        item: XtreamLiveChannelItem,
        archive: EpgProgram | null,
        categoryId: XtreamLiveSource['categoryId'],
        captureNavigation?: () => void,
        queue?: readonly XtreamLiveChannelItem[],
        remote = false
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
                      captureNavigation,
                      remote,
                  }
                : undefined;
        this.panelPlayback = playback;
        const lifecycle =
            launch &&
            this.sessions.begin(playback.streamUrl, launch.lockSource);
        if (launch) {
            launch.ended = lifecycle?.ended;
            this.requests.set(playback.streamUrl, launch);
        }
        this.pending.set(launch);
        const recover = () => {
            if (this.pending() !== launch || this.destroyRef.destroyed) return;
            this.pending.set(undefined);
            const confirmed = this.confirmed();
            if (confirmed) this.syncPanel(confirmed);
        };
        void Promise.resolve(
            this.store.openPlayer(
                playback.streamUrl,
                playback.title,
                playback.thumbnail
            )
        ).then(
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
        capture: () => void,
        queue: readonly XtreamLiveChannelItem[]
    ): boolean {
        const pending = this.pending();
        if (
            !pending ||
            pending.ended?.() ||
            pending.archive ||
            pending.item.xtream_id !== item.xtream_id
        )
            return false;
        if (!sameXtreamChannelCopy(pending.item, item)) {
            pending.item = item;
            pending.lockSource.categoryId = category();
            pending.lockSource.channel = item;
            pending.lockSource.queue = queue;
            pending.captureNavigation = capture;
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
            captureNavigation: () => this.panel?.capture(item, queue),
        };
        this.requests.set(playing.session.streamUrl, copy);
        this.playing.set(copy);
        this.sessions.update(playing.session, copy.lockSource);
        this.syncPanel(copy);
    }

    resolveCategory(
        url: string,
        item: XtreamLiveChannelItem,
        categoryId: number
    ): void {
        const launch = this.requests.get(url);
        if (launch?.item === item) launch.lockSource.categoryId = categoryId;
    }

    restoreConfirmedPanel(): boolean {
        const confirmed = this.confirmed();
        if (!confirmed || this.panel?.current() !== this.panelPlayback)
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
            captureNavigation: () =>
                this.panel?.capture(item, source.queue ?? [item]),
        };
    }

    private syncPanel(launch: GuideLaunch): void {
        const panel = this.panel;
        if (!panel) return;
        const current = panel.current();
        launch.captureNavigation?.();
        if (current && current !== this.panelPlayback) return;
        if (current === launch.playback && panel.currentItem() === launch.item)
            return;
        this.panelPlayback = launch.playback;
        panel.restore(launch);
    }
}
