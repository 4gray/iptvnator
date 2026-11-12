import { computed, Injectable, signal } from '@angular/core';
import {
    ExternalPlayerSession,
    PlayerContentInfo,
} from '@iptvnator/shared/interfaces';
import { Subject } from 'rxjs';

/** Launch order when both carry it, else the start time. */
function startedBefore(
    session: ExternalPlayerSession,
    other: ExternalPlayerSession
): boolean {
    if (session.launchOrder !== undefined && other.launchOrder !== undefined) {
        return session.launchOrder < other.launchOrder;
    }
    return Date.parse(session.startedAt) < Date.parse(other.startedAt);
}

@Injectable({
    providedIn: 'root',
})
export class ExternalPlaybackService {
    readonly activeSession = signal<ExternalPlayerSession | null>(null);
    private readonly userStops = new Subject<string>();
    readonly stopRequested = this.userStops.asObservable();
    private readonly dismissedSessionId = signal<string | null>(null);

    readonly visibleSession = computed(() => {
        const session = this.activeSession();
        if (!session || session.status === 'closed') {
            return null;
        }

        if (this.dismissedSessionId() === session.id) {
            return null;
        }

        return session;
    });

    constructor() {
        window.electron?.onExternalPlayerSessionUpdate?.((session) => {
            this.handleSessionUpdate(session);
        });
    }

    dismissActiveSession(): void {
        const session = this.activeSession();
        if (!session) {
            return;
        }

        this.dismissedSessionId.set(session.id);
    }

    restoreDismissedSession(sessionId: string): void {
        if (
            this.activeSession()?.id === sessionId &&
            this.dismissedSessionId() === sessionId
        )
            this.dismissedSessionId.set(null);
    }

    restoreDisplacedSession(
        session: ExternalPlayerSession,
        displacedId: string
    ): void {
        if (this.activeSession()?.id === displacedId)
            this.handleSessionUpdate({
                ...session,
                restoredFromSessionId: displacedId,
            });
    }

    async closeActiveSession(): Promise<void> {
        await this.closeSession(this.activeSession(), true);
    }

    async closeSession(
        session: ExternalPlayerSession | null | undefined,
        userRequested = false
    ): Promise<void> {
        if (!session) {
            return;
        }

        if (!session.canClose || !window.electron?.closeExternalPlayerSession) {
            this.dismissedSessionId.set(session.id);
            return;
        }

        const previousDismissedSessionId = this.dismissedSessionId();
        if (userRequested) this.userStops.next(session.id);
        this.dismissedSessionId.set(session.id);

        try {
            const updatedSession =
                await window.electron.closeExternalPlayerSession(session.id);
            if (updatedSession) {
                this.handleSessionUpdate(updatedSession);
                return;
            }

            this.activeSession.update((current) =>
                current?.id === session.id
                    ? {
                          ...current,
                          status: 'closed',
                          canClose: false,
                          updatedAt: new Date().toISOString(),
                      }
                    : current
            );
        } catch (error) {
            if (this.dismissedSessionId() === session.id) {
                this.dismissedSessionId.set(previousDismissedSessionId);
            }
            throw error;
        }
    }

    findMatchingSession(
        contentInfo: PlayerContentInfo | null | undefined
    ): ExternalPlayerSession | null {
        const session = this.activeSession();
        if (!contentInfo || !session?.contentInfo) {
            return null;
        }

        if (session.status === 'error' || session.status === 'closed') {
            return null;
        }

        return this.matchesContent(contentInfo, session.contentInfo)
            ? session
            : null;
    }

    private handleSessionUpdate(session: ExternalPlayerSession): void {
        const current = this.activeSession();
        const restoresCurrentReplacement =
            current?.id === session.restoredFromSessionId;
        // A launching update means a new launch only when it did not start
        // before the current one: an older launch still settling (MPV runs
        // launches one at a time) must not take the dock back from it.
        const isLatestLaunch =
            session.status === 'launching' &&
            (!current ||
                current.id === session.id ||
                !startedBefore(session, current));

        if (
            !current ||
            current.id === session.id ||
            isLatestLaunch ||
            restoresCurrentReplacement
        ) {
            this.activeSession.set(session);
        }

        if (isLatestLaunch || restoresCurrentReplacement) {
            this.dismissedSessionId.set(null);
        }
    }

    private matchesContent(
        left: PlayerContentInfo,
        right: PlayerContentInfo
    ): boolean {
        return (
            left.playlistId === right.playlistId &&
            left.contentType === right.contentType &&
            left.contentXtreamId === right.contentXtreamId
        );
    }
}
