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

type Launch = {
    source: XtreamLiveSource;
    ended: WritableSignal<boolean>;
    retired?: boolean;
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
        return this.sessions.get(id);
    }

    latestOpened(
        playlistId: string,
        excludeId?: string
    ): ExternalPlayerSession | undefined {
        this.revision();
        this.lock.version();
        let latest: ExternalPlayerSession | undefined;
        for (const { session, source } of this.sessions.values()) {
            if (
                session.id === excludeId ||
                source.playlistId !== playlistId ||
                !source.channel ||
                session.playbackIdle ||
                isXtreamLiveCategoryWithheld(this.lock, source) ||
                (session.status !== 'opened' && session.status !== 'playing')
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
        if (session.status === 'error' || session.playbackIdle)
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

    private enforce(entry: Active): void {
        const { session, source } = entry;
        if (this.sessions.get(session.id) !== entry) return;
        if (!isXtreamLiveCategoryWithheld(this.lock, source)) {
            clearTimeout(entry.retry);
            entry.retry = undefined;
            if (entry.hidden && !entry.closing) {
                entry.hidden = false;
                this.playback?.restoreDismissedSession?.(session.id);
            }
            return;
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
        if (this.playback.activeSession()?.id === session.id) {
            entry.hidden = true;
            this.playback.dismissActiveSession?.();
        }
        const close = bridge?.closeExternalPlayerSession
            ? bridge
                  .closeExternalPlayerSession(session.id, true)
                  .then((result) => {
                      if (isLiveExternalPlayerSession(result)) {
                          // An in-flight queue entry has not attached its own closer yet.
                          entry.closing = false;
                          if (
                              entry.session !== session ||
                              !isXtreamLiveCategoryWithheld(
                                  this.lock,
                                  entry.source
                              )
                          )
                              this.enforce(entry);
                      } else
                          this.update(
                              result ?? {
                                  ...session,
                                  status: 'closed',
                                  canClose: false,
                              }
                          );
                  })
            : this.playback.closeSession(session);
        void close.catch(() => {
            entry.closing = false;
            if (
                this.destroyRef.destroyed ||
                this.sessions.get(session.id) !== entry
            )
                return;
            if (!isXtreamLiveCategoryWithheld(this.lock, entry.source)) {
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
