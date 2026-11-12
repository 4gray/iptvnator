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
    captureXtreamLiveOwner,
    hasXtreamOpenedMedia,
    isXtreamLiveCategoryWithheld,
    sameXtreamLiveOwner,
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
    ended?: () => false | 'ended' | 'failed';
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
    private readonly owner = computed(() =>
        captureXtreamLiveOwner(this.store.currentPlaylist())
    );
    private readonly pending = signal<GuideLaunch | undefined>(undefined);
    private readonly failedTuning = signal<GuideLaunch | undefined>(undefined);
    private panel?: GuidePanel;
    private panelPlayback?: ResolvedPortalPlayback;
    private readonly panelSessionId = signal<string | undefined>(undefined);

    readonly hasSessionUpdates =
        !!this.playback &&
        typeof window.electron?.onExternalPlayerSessionUpdate === 'function';
    private readonly playing = linkedSignal({
        source: () => ({
            owner: this.owner(),
            active: this.playback?.activeSession(),
        }),
        computation: ({ owner, active }, previous): ConfirmedLaunch | null => {
            if (!owner || !this.hasSessionUpdates) return null;
            const prior = previous?.value;
            const activeSource = hasXtreamOpenedMedia(active)
                ? this.sessions.state(active.id)?.source
                : undefined;
            const owned =
                !!activeSource && sameXtreamLiveOwner(activeSource, owner);
            this.lock.version();
            const previousSession =
                prior &&
                sameXtreamLiveOwner(prior.lockSource, owner) &&
                prior.session.id !== active?.id
                    ? this.sessions.state(prior.session.id)?.session
                    : undefined;
            const session =
                owned && !isXtreamLiveCategoryWithheld(this.lock, activeSource)
                    ? active
                    : (this.sessions.latestOpened(owner, active?.id) ??
                      (owned ? active : previousSession));
            if (!hasXtreamOpenedMedia(session)) return null;
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
        const playing = this.playing();
        return this.isAllowed(playing?.lockSource) ? playing : null;
    });

    readonly launching = computed(() => {
        const active = this.playback?.activeSession();
        if (!active || this.playing()) return false;
        if (
            active.status !== 'launching' &&
            !(
                active.mediaLoaded === false &&
                !active.playbackIdle &&
                (active.status === 'opened' || active.status === 'playing')
            )
        )
            return false;
        return this.isAllowed(this.sessions.state(active.id)?.source);
    });

    readonly idlePlayback = computed(() => {
        const ids = [this.playback?.activeSession()?.id, this.panelSessionId()];
        for (const id of ids) {
            const entry = id ? this.sessions.state(id) : undefined;
            if (
                entry?.session.playbackIdle &&
                (entry.session.status === 'opened' ||
                    entry.session.status === 'playing') &&
                this.isAllowed(entry.source)
            )
                return entry.source;
        }
        return undefined;
    });

    stoppedTuningSource(): XtreamLiveSource | undefined {
        const idle = this.idlePlayback();
        if (idle) return idle;
        const failed = this.failedTuning()?.lockSource;
        return this.isAllowed(failed) ? failed : undefined;
    }

    readonly unverifiedPlayback = computed(() => {
        const active = this.playback?.activeSession();
        if (
            !(active?.playbackUnverified || active?.mediaReadinessTimedOut) ||
            active.playbackIdle ||
            (active.status !== 'opened' && active.status !== 'playing')
        )
            return undefined;
        const source = this.sessions.state(active.id)?.source;
        return this.isAllowed(source) ? { session: active, source } : undefined;
    });

    remoteTuningItem(): XtreamLiveChannelItem | undefined {
        const pending = this.pending();
        return pending?.remote &&
            !pending.ended?.() &&
            this.isAllowed(pending.lockSource)
            ? pending.item
            : undefined;
    }

    private isAllowed(source?: XtreamLiveSource): source is XtreamLiveSource {
        this.lock.version();
        return (
            !!source &&
            sameXtreamLiveOwner(source, this.owner()) &&
            !isXtreamLiveCategoryWithheld(this.lock, source)
        );
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
                if (confirmedRequest || ended) this.pending.set(undefined);
                if (ended === 'failed' && !playing)
                    this.failedTuning.set(pending);
                if (!playing) return;
                this.failedTuning.set(undefined);
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
        this.failedTuning.set(undefined);
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
        const owner = this.owner();
        const launch: GuideLaunch | undefined =
            owner && this.hasSessionUpdates
                ? {
                      lockSource: {
                          ...owner,
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
        this.panelPlayback = this.panel?.current() ?? playback;
        const lifecycle = launch && this.sessions.begin(launch.lockSource);
        if (launch) launch.ended = lifecycle?.ended;
        this.pending.set(launch);
        const recover = (failed: boolean) => {
            if (this.pending() !== launch || this.destroyRef.destroyed) return;
            this.pending.set(undefined);
            const confirmed = this.confirmed();
            if (confirmed) this.syncPanel(confirmed);
            else if (failed) this.failedTuning.set(launch);
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
                    recover(!session || session.status === 'error');
            },
            () => {
                lifecycle?.finish();
                recover(true);
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
            !sameXtreamLiveOwner(pending.lockSource, this.owner()) ||
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

    cancelPendingSwitch(item: XtreamLiveChannelItem): boolean {
        const confirmed = this.confirmed();
        if (
            !confirmed ||
            !this.sessions.cancelPendingSwitches(
                confirmed.lockSource,
                item.xtream_id,
                confirmed.session.id
            )
        )
            return false;
        if (this.pending()?.ended?.()) this.pending.set(undefined);
        this.syncPanel(confirmed);
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
        for (const launch of [
            this.pending(),
            this.playing(),
            this.failedTuning(),
        ])
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
        const { channel: item, playback, archive } = source;
        return item && playback
            ? { lockSource: source, item, archive: archive ?? null, playback }
            : undefined;
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
