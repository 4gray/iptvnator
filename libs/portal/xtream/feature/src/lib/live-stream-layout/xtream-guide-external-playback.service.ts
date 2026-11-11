import {
    computed,
    DestroyRef,
    effect,
    inject,
    Injectable,
    linkedSignal,
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
import { sameGuideChannel } from './xtream-epg-guide-source.service';
import {
    isXtreamLiveCategoryWithheld,
    XtreamExternalLiveSessions,
    type XtreamLiveSource,
} from './xtream-external-live-sessions.service';
import type { XtreamLiveChannelItem } from './xtream-live-channel-navigation.service';

interface GuideLaunch {
    lockSource: XtreamLiveSource;
    item: XtreamLiveChannelItem;
    archive: EpgProgram | null;
    playback: ResolvedPortalPlayback;
    captureNavigation?: () => void;
}

type ConfirmedLaunch = GuideLaunch & { session: ExternalPlayerSession };

interface GuidePanel {
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
    return session?.status === 'opened' || session?.status === 'playing';
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
    private pending?: GuideLaunch;
    private panel?: GuidePanel;
    private panelPlayback?: ResolvedPortalPlayback;
    private panelSessionId?: string;

    readonly hasBridge = !!this.playback;
    private readonly playing = linkedSignal({
        source: () => ({
            playlistId: this.store.currentPlaylist()?.id,
            active: this.playback?.activeSession(),
        }),
        computation: (
            { playlistId, active },
            previous
        ): ConfirmedLaunch | null => {
            const prior =
                previous?.value?.lockSource.playlistId === playlistId
                    ? previous?.value
                    : null;
            if (!hasOpened(active)) {
                if (!prior || prior.session.id === active?.id) return null;
                const session = this.sessions.state(prior.session.id)?.session;
                return hasOpened(session) ? { ...prior, session } : null;
            }
            const launch =
                prior?.session.id === active.id
                    ? prior
                    : (this.requests.get(active.streamUrl) ??
                      this.reattach(active));
            if (!launch || launch.lockSource.playlistId !== playlistId)
                return null;
            if (launch === this.pending) {
                this.requests.clear();
                this.requests.set(active.streamUrl, launch);
                this.pending = undefined;
            }
            return { ...launch, session: active };
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
        const pending = this.requests.get(active.streamUrl);
        this.lock.version();
        return (
            !!pending &&
            !isXtreamLiveCategoryWithheld(this.lock, pending.lockSource)
        );
    });

    constructor() {
        effect(() => {
            const active = this.playback?.activeSession();
            untracked(() => {
                const playing = this.confirmed();
                if (
                    !active ||
                    playing?.session !== active ||
                    (this.panelSessionId === active.id &&
                        !active.restoredFromSessionId)
                )
                    return;
                this.panelSessionId = active.id;
                this.syncPanel(playing);
            });
        });
    }

    bind(panel: GuidePanel): void {
        this.panel = panel;
    }

    reset(): void {
        this.requests.clear();
        this.pending = undefined;
        this.panelPlayback = undefined;
        this.panelSessionId = undefined;
    }

    start(
        playback: ResolvedPortalPlayback | null,
        item: XtreamLiveChannelItem,
        archive: EpgProgram | null,
        categoryId: XtreamLiveSource['categoryId'],
        captureNavigation?: () => void,
        queue?: readonly XtreamLiveChannelItem[]
    ): void {
        if (!playback?.streamUrl) return;
        const playlistId = this.store.currentPlaylist()?.id;
        const launch = playlistId
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
              }
            : undefined;
        this.panelPlayback = playback;
        this.pending = launch;
        if (launch) this.requests.set(playback.streamUrl, launch);
        const finish =
            launch &&
            this.sessions.begin(playback.streamUrl, launch.lockSource);
        const recover = () => {
            if (this.pending !== launch || this.destroyRef.destroyed) return;
            this.pending = undefined;
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
                finish?.(session);
                if (
                    !session ||
                    !isLiveExternalPlayerSession(session) ||
                    session.status === 'error'
                )
                    recover();
            },
            () => {
                finish?.();
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
        const pending = this.pending;
        if (
            !pending ||
            pending.archive ||
            pending.item.xtream_id !== item.xtream_id
        )
            return false;
        if (!sameGuideChannel(pending.item, item)) {
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
        categoryId: XtreamLiveSource['categoryId'],
        captureNavigation: () => void
    ): void {
        const playing = this.confirmed();
        if (!playing) return;
        const copy = {
            ...playing,
            item,
            lockSource: { ...playing.lockSource, categoryId, channel: item },
            captureNavigation,
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

    private reattach(session: ExternalPlayerSession): GuideLaunch | undefined {
        const source = this.sessions.state(session.id)?.source;
        const item = source?.channel;
        if (!source?.playback || !item) return;
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
