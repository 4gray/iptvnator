import {
    DestroyRef,
    effect,
    inject,
    Injectable,
    signal,
    untracked,
} from '@angular/core';
import {
    isLiveExternalPlayerSession,
    PORTAL_EXTERNAL_PLAYBACK,
} from '@iptvnator/portal/shared/util';
import { ParentalLockService } from '@iptvnator/services';
import type { XtreamPlaylistData } from '@iptvnator/portal/xtream/data-access';
import type {
    EpgProgram,
    ExternalPlayerSession,
    ResolvedPortalPlayback,
} from '@iptvnator/shared/interfaces';
import type { XtreamLiveChannelItem } from './xtream-live-channel-navigation.service';
import {
    cancelXtreamLaunch,
    createXtreamLaunchCompletion,
    XtreamNativeHandoff,
    type GuideLaunchOutcome,
    type XtreamOwnedLaunch as Launch,
} from './xtream-native-handoff';

export type XtreamLiveOwner = Pick<
    XtreamPlaylistData,
    'serverUrl' | 'username' | 'password'
> & {
    playlistId: string;
};

export function captureXtreamLiveOwner(
    playlist?: XtreamPlaylistData | null
): XtreamLiveOwner | undefined {
    if (!playlist?.id) return undefined;
    const { id: playlistId, serverUrl, username, password } = playlist;
    return { playlistId, serverUrl, username, password };
}

export function sameXtreamLiveOwner(
    left: XtreamLiveOwner | undefined,
    right: XtreamLiveOwner | undefined
): boolean {
    return (
        !!left &&
        !!right &&
        left.playlistId === right.playlistId &&
        left.serverUrl === right.serverUrl &&
        left.username === right.username &&
        left.password === right.password
    );
}

export interface XtreamLiveSource extends XtreamLiveOwner {
    categoryId: number | null | 'unknown';
    channel?: XtreamLiveChannelItem;
    archive?: EpgProgram | null;
    playback?: ResolvedPortalPlayback;
    queue?: readonly XtreamLiveChannelItem[];
}

export function isXtreamLiveCategoryWithheld(
    lock: ParentalLockService,
    {
        playlistId,
        categoryId,
    }: Pick<XtreamLiveSource, 'playlistId' | 'categoryId'>
): boolean {
    return categoryId === 'unknown'
        ? lock.active()
        : categoryId !== null &&
              lock.isXtreamCategoryLocked(playlistId, 'live', categoryId);
}

export function hasXtreamOpenedMedia(
    session: ExternalPlayerSession | null | undefined
): session is ExternalPlayerSession & { status: 'opened' | 'playing' } {
    return (
        (session?.status === 'opened' || session?.status === 'playing') &&
        !session.playbackIdle &&
        session.mediaLoaded !== false
    );
}

type Active = {
    session: ExternalPlayerSession;
    source: XtreamLiveSource;
    launch?: Launch;
    closing?: boolean;
    hidden?: boolean;
    retry?: ReturnType<typeof setTimeout>;
};

/** Enforce parental locks on owned sessions even after they leave the global dock. */
@Injectable({ providedIn: 'root' })
export class XtreamExternalLiveSessions {
    private readonly playback = inject(PORTAL_EXTERNAL_PLAYBACK, {
        optional: true,
    });
    private readonly lock = inject(ParentalLockService);
    private readonly destroyRef = inject(DestroyRef);
    private readonly pending = new Map<string, Launch>();
    private readonly sessions = new Map<string, Active>();
    private readonly revision = signal(0);
    readonly handoff = new XtreamNativeHandoff(
        sameXtreamLiveOwner,
        this.playback?.pendingStop?.bind(this.playback)
    );

    constructor() {
        const unsubscribe = window.electron?.onExternalPlayerSessionUpdate?.(
            (session) => this.update(session)
        );
        this.destroyRef.onDestroy(() => {
            unsubscribe?.();
            this.sessions.forEach((entry) => clearTimeout(entry.retry));
        });
        effect(() => {
            this.lock.version();
            untracked(() =>
                this.sessions.forEach((entry) => this.enforce(entry))
            );
        });
    }

    state(id: string): Pick<Active, 'session' | 'source'> | undefined {
        this.revision();
        const entry = this.sessions.get(id);
        return entry?.launch?.cancelled ? undefined : entry;
    }

    closeBeforeTune(
        source: XtreamLiveSource,
        player: string | undefined,
        confirmedId: string | undefined,
        isCurrent: () => boolean
    ) {
        return this.handoff.beforeTune(
            source,
            player,
            [this.playback?.activeSession()?.id, confirmedId],
            (id) => this.state(id),
            isCurrent
        );
    }

    latestOpened(
        owner: XtreamLiveOwner,
        excludeId?: string
    ): ExternalPlayerSession | undefined {
        this.revision();
        this.lock.version();
        let latest: ExternalPlayerSession | undefined;
        for (const { session, source, launch } of this.sessions.values()) {
            if (
                session.id === excludeId ||
                !sameXtreamLiveOwner(source, owner) ||
                launch?.cancelled ||
                !source.channel ||
                !hasXtreamOpenedMedia(session) ||
                isXtreamLiveCategoryWithheld(this.lock, source)
            )
                continue;
            const newer =
                !latest ||
                (session.launchOrder !== undefined &&
                latest.launchOrder !== undefined
                    ? session.launchOrder >= latest.launchOrder
                    : Date.parse(session.startedAt) >=
                      Date.parse(latest.startedAt));
            if (newer) latest = session;
        }
        return latest;
    }

    begin(source: XtreamLiveSource, launchId: string = crypto.randomUUID()) {
        const launch: Launch = {
            source,
            ended: signal<GuideLaunchOutcome>(false),
            completion: createXtreamLaunchCompletion(),
        };
        this.pending.set(launchId, launch);
        return {
            launchId,
            ended: launch.ended.asReadonly(),
            dispatch: () => {
                launch.completion.dispatch();
                this.handoff.dispatch(source);
            },
            finish: (result?: ExternalPlayerSession | void) => {
                this.pending.delete(launchId);
                launch.completion.finish(result);
                this.handoff.finish(source, result || undefined);
                if (!result || launch.retired) return;
                const current = this.sessions.get(result.id);
                const latest = current?.session;
                this.record(
                    latest &&
                        latest.status !== 'launching' &&
                        isLiveExternalPlayerSession(result)
                        ? latest
                        : result,
                    current?.source ?? source,
                    launch
                );
            },
        };
    }

    cancelPendingSwitches(
        owner: XtreamLiveOwner,
        {
            keep,
            dockStopId,
        }: {
            keep?: { channelId: number; sessionId: string };
            dockStopId?: string;
        } = {}
    ): Promise<void> | undefined {
        const launches = new Set(this.pending.values());
        this.sessions.forEach(({ launch }) => {
            if (launch) launches.add(launch);
        });
        const dockLaunch = dockStopId && this.sessions.get(dockStopId)?.launch;
        if (dockLaunch) launches.delete(dockLaunch);
        const cancelled = new Set(
            [...launches].filter(
                (launch) =>
                    sameXtreamLiveOwner(launch.source, owner) &&
                    cancelXtreamLaunch(launch, keep)
            )
        );
        if (!cancelled.size) return;
        this.revision.update((value) => value + 1);
        for (const entry of [...this.sessions.values()].reverse())
            if (entry.launch && cancelled.has(entry.launch))
                this.enforce(entry);
        return Promise.all(
            [...cancelled].map((launch) => launch.completion.wait())
        ).then(() => undefined);
    }

    update(session: ExternalPlayerSession, source?: XtreamLiveSource): void {
        this.record(session, source);
    }

    private record(
        session: ExternalPlayerSession,
        source?: XtreamLiveSource,
        request?: Launch
    ): void {
        const id = session.id;
        const current = this.sessions.get(id);
        const launch =
            current?.launch ??
            request ??
            (session.launchId ? this.pending.get(session.launchId) : undefined);
        launch?.completion.observe(session);
        if (launch) this.handoff.observe(launch.source, session);
        if (launch && session.closedByRequest) launch.ended.set('ended');
        else if (
            (session.status === 'error' || session.status === 'closed') &&
            launch &&
            !launch.opened &&
            !launch.cancelled
        )
            launch.ended.set('failed');
        if (!isLiveExternalPlayerSession(session)) {
            if (launch) {
                launch.retired = true;
                launch.ended.update((ended) => ended || 'ended');
            }
            clearTimeout(current?.retry);
            if (this.sessions.delete(id))
                this.revision.update((value) => value + 1);
            if (launch) this.restoreSurvivingSession(launch, id);
            return;
        }
        const owner = source ?? current?.source ?? launch?.source;
        if (!owner) return;
        if (
            launch &&
            session.mediaLoaded !== false &&
            hasXtreamOpenedMedia(session)
        )
            launch.opened = true;
        if (
            launch &&
            !launch.opened &&
            session.mediaLoaded === false &&
            session.playbackIdle &&
            this.playback?.activeSession()?.id === id
        )
            launch.restoreSessionId ??= this.latestOpened(owner, id)?.id;
        if (
            session.status === 'error' ||
            session.playbackIdle ||
            (session.mediaLoaded === false &&
                (session.mediaObservationUnavailable ||
                    session.mediaReadinessTimedOut ||
                    (session.player === 'mpv' && session.playbackUnverified)))
        )
            launch?.ended.update(
                (ended) => ended || (launch.opened ? 'ended' : 'retryable')
            );
        const entry = current ?? { session, source: owner, launch };
        const changed =
            !current || current.session !== session || current.source !== owner;
        entry.session = session;
        entry.source = owner;
        entry.launch = launch;
        this.sessions.set(session.id, entry);
        if (changed) this.revision.update((value) => value + 1);
        this.enforce(entry);
    }

    private restoreSurvivingSession(launch: Launch, displacedId: string): void {
        if (this.playback?.activeSession()?.id !== displacedId) return;
        const explicit = launch.restoreSessionId
            ? this.state(launch.restoreSessionId)
            : undefined;
        const survivor =
            explicit &&
            sameXtreamLiveOwner(explicit.source, launch.source) &&
            !isXtreamLiveCategoryWithheld(this.lock, explicit.source)
                ? explicit.session
                : !launch.cancelled
                  ? this.latestOpened(launch.source, displacedId)
                  : undefined;
        if (hasXtreamOpenedMedia(survivor))
            this.playback.restoreDisplacedSession?.(survivor, displacedId);
    }

    private needsClose(entry: Active): boolean {
        return (
            !!entry.launch?.cancelled ||
            (!!entry.launch?.restoreSessionId &&
                !entry.launch.opened &&
                entry.session.playbackIdle === true) ||
            isXtreamLiveCategoryWithheld(this.lock, entry.source)
        );
    }

    private enforce(entry: Active): void {
        const { session } = entry;
        if (this.sessions.get(session.id) !== entry) return;
        if (!this.needsClose(entry)) {
            clearTimeout(entry.retry);
            entry.retry = undefined;
            if (entry.hidden && !entry.closing) {
                entry.hidden = false;
                this.playback?.restoreDismissedSession?.(session.id);
            }
            return;
        }
        if (
            this.playback?.activeSession()?.id === session.id &&
            (entry.launch?.cancelled ||
                isXtreamLiveCategoryWithheld(this.lock, entry.source))
        ) {
            entry.hidden = true;
            this.playback.dismissActiveSession?.();
        }
        if (!session.canClose || entry.closing || entry.retry || !this.playback)
            return;
        const bridge = window.electron;
        if (
            !bridge?.closeExternalPlayerSession &&
            session.status === 'launching'
        )
            return;
        entry.closing = true;
        const close = bridge?.closeExternalPlayerSession
            ? bridge
                  .closeExternalPlayerSession(session.id, true)
                  .then((result) => {
                      if (isLiveExternalPlayerSession(result)) {
                          // An in-flight queue entry has not attached its own closer yet.
                          entry.closing = false;
                          if (
                              entry.session !== session ||
                              !this.needsClose(entry)
                          )
                              this.enforce(entry);
                      } else {
                          this.update(
                              result ?? {
                                  ...session,
                                  status: 'closed',
                                  canClose: false,
                                  closedByRequest: true,
                              }
                          );
                      }
                  })
            : this.playback.closeSession(session);
        void close.catch(() => {
            entry.closing = false;
            if (
                this.destroyRef.destroyed ||
                this.sessions.get(session.id) !== entry
            )
                return;
            if (!this.needsClose(entry)) {
                this.enforce(entry);
                return;
            }
            entry.retry = setTimeout(() => {
                entry.retry = undefined;
                this.enforce(entry);
            }, 1000);
        });
    }
}
