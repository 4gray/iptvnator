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
import type { ExternalPlayerSession } from '@iptvnator/shared/interfaces';

export interface XtreamLiveSource {
    playlistId: string;
    categoryId: number | null | 'unknown';
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
    sessionId?: string;
    retired?: boolean;
};
type Active = {
    session: ExternalPlayerSession;
    source: XtreamLiveSource;
    launch?: Launch;
    closing?: boolean;
};

/** Enforce parental locks on owned sessions even after they leave the global dock. */
@Injectable({ providedIn: 'root' })
export class XtreamExternalLiveSessions {
    private readonly playback = inject(PORTAL_EXTERNAL_PLAYBACK, {
        optional: true,
    });
    private readonly lock = inject(ParentalLockService);
    private readonly pending = new Map<string, Launch[]>();
    private readonly sessions = new Map<string, Active>();
    private readonly revision = signal(0);

    constructor() {
        const unsubscribe = window.electron?.onExternalPlayerSessionUpdate?.(
            (session) => this.update(session)
        );
        if (unsubscribe) inject(DestroyRef).onDestroy(unsubscribe);
        effect(() => {
            this.lock.version();
            untracked(() =>
                this.sessions.forEach((entry) => this.enforce(entry))
            );
        });
    }

    snapshot(id: string): ExternalPlayerSession | undefined {
        this.revision();
        return this.sessions.get(id)?.session;
    }

    begin(
        url: string,
        source: XtreamLiveSource
    ): (result?: ExternalPlayerSession | void) => void {
        const launch: Launch = { source };
        const pending = this.pending.get(url) ?? [];
        pending.push(launch);
        this.pending.set(url, pending);
        return (result) => {
            pending.splice(pending.indexOf(launch), 1);
            if (!pending.length) this.pending.delete(url);
            if (!result || launch.retired) return;
            const latest = this.sessions.get(result.id)?.session;
            this.update(
                latest &&
                    latest.status !== 'launching' &&
                    isLiveExternalPlayerSession(result)
                    ? latest
                    : result,
                source
            );
        };
    }

    update(session: ExternalPlayerSession, source?: XtreamLiveSource): void {
        const id = session.id;
        const current = this.sessions.get(id);
        if (!isLiveExternalPlayerSession(session)) {
            if (current?.launch) current.launch.retired = true;
            if (this.sessions.delete(id))
                this.revision.update((value) => value + 1);
            return;
        }
        const launch =
            current?.launch ??
            this.pending
                .get(session.streamUrl)
                ?.find((entry) => !entry.sessionId);
        const owner = source ?? current?.source ?? launch?.source;
        if (!owner) return;
        if (launch) launch.sessionId = session.id;
        const entry = current ?? { session, source: owner, launch };
        const changed = !current || current.session !== session;
        entry.session = session;
        entry.source = owner;
        this.sessions.set(session.id, entry);
        if (changed) this.revision.update((value) => value + 1);
        this.enforce(entry);
    }

    private enforce(entry: Active): void {
        const { session, source } = entry;
        if (!session.canClose || entry.closing || !this.playback) return;
        if (!isXtreamLiveCategoryWithheld(this.lock, source)) return;
        const bridge = window.electron;
        if (
            !bridge?.closeExternalPlayerSession &&
            session.status === 'launching'
        )
            return;
        entry.closing = true;
        if (this.playback.activeSession()?.id === session.id)
            this.playback.dismissActiveSession?.();
        const close = bridge?.closeExternalPlayerSession
            ? bridge
                  .closeExternalPlayerSession(session.id, true)
                  .then((result) => {
                      if (isLiveExternalPlayerSession(result)) {
                          // An in-flight queue entry has not attached its own closer yet.
                          entry.closing = false;
                          if (entry.session !== session) this.enforce(entry);
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
        });
    }
}
