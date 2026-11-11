import {
    DestroyRef,
    effect,
    inject,
    Injectable,
    signal,
    untracked,
    type WritableSignal,
} from '@angular/core';
import {
    isLiveExternalPlayerSession,
    PORTAL_EXTERNAL_PLAYBACK,
} from '@iptvnator/portal/shared/util';
import { ParentalLockService } from '@iptvnator/services';
import type {
    EpgProgram,
    ExternalPlayerSession,
    ResolvedPortalPlayback,
} from '@iptvnator/shared/interfaces';
import type { XtreamLiveChannelItem } from './xtream-live-channel-navigation.service';

export interface XtreamLiveSource {
    playlistId: string;
    categoryId: number | null | 'unknown';
    channel?: XtreamLiveChannelItem;
    archive?: EpgProgram | null;
    playback?: ResolvedPortalPlayback;
    queue?: readonly XtreamLiveChannelItem[];
}

export function isXtreamLiveCategoryWithheld(
    lock: ParentalLockService,
    { playlistId, categoryId }: XtreamLiveSource
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

type Launch = {
    source: XtreamLiveSource;
    ended: WritableSignal<boolean>;
    retired?: boolean;
    cancelled?: boolean;
    opened?: boolean;
    restoreSessionId?: string;
};
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

    state(
        id: string
    ):
        | { session: ExternalPlayerSession; source: XtreamLiveSource }
        | undefined {
        this.revision();
        const entry = this.sessions.get(id);
        return entry?.launch?.cancelled ? undefined : entry;
    }

    latestOpened(
        playlistId: string,
        excludeId?: string
    ): ExternalPlayerSession | undefined {
        this.revision();
        this.lock.version();
        let latest: ExternalPlayerSession | undefined;
        for (const { session, source, launch } of this.sessions.values()) {
            if (
                session.id === excludeId ||
                source.playlistId !== playlistId ||
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

    begin(source: XtreamLiveSource) {
        const launchId = crypto.randomUUID();
        const launch: Launch = { source, ended: signal(false) };
        this.pending.set(launchId, launch);
        return {
            launchId,
            ended: launch.ended.asReadonly(),
            finish: (result?: ExternalPlayerSession | void) => {
                this.pending.delete(launchId);
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
        playlistId: string,
        channelId: number,
        restoreSessionId: string
    ): boolean {
        const launches = new Set(this.pending.values());
        this.sessions.forEach(({ launch }) => {
            if (launch) launches.add(launch);
        });
        const cancelled = new Set<Launch>();
        for (const launch of launches) {
            const { source } = launch;
            if (
                launch.retired ||
                launch.cancelled ||
                launch.opened ||
                source.playlistId !== playlistId ||
                !source.channel ||
                (source.channel.xtream_id === channelId && !source.archive)
            )
                continue;
            launch.cancelled = true;
            launch.restoreSessionId = restoreSessionId;
            launch.ended.set(true);
            cancelled.add(launch);
        }
        if (!cancelled.size) return false;
        this.revision.update((value) => value + 1);
        for (const entry of [...this.sessions.values()].reverse())
            if (entry.launch && cancelled.has(entry.launch))
                this.enforce(entry);
        return true;
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
        if (!isLiveExternalPlayerSession(session)) {
            if (launch) {
                launch.retired = true;
                launch.ended.set(true);
            }
            clearTimeout(current?.retry);
            if (this.sessions.delete(id))
                this.revision.update((value) => value + 1);
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
            session.status === 'error' ||
            session.playbackIdle ||
            (session.mediaLoaded === false &&
                (session.mediaObservationUnavailable ||
                    session.mediaReadinessTimedOut ||
                    (session.player === 'mpv' && session.playbackUnverified)))
        )
            launch?.ended.set(true);
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

    private needsClose(entry: Active): boolean {
        return (
            !!entry.launch?.cancelled ||
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
        if (this.playback?.activeSession()?.id === session.id) {
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
                              }
                          );
                          const survivor = entry.launch?.restoreSessionId;
                          const restore = survivor
                              ? this.state(survivor)
                              : undefined;
                          if (
                              restore &&
                              hasXtreamOpenedMedia(restore.session) &&
                              !isXtreamLiveCategoryWithheld(
                                  this.lock,
                                  restore.source
                              )
                          )
                              this.playback?.restoreDisplacedSession?.(
                                  restore.session,
                                  session.id
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
