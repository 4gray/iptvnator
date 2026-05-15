import { computed, Injectable, signal } from '@angular/core';
import { ExternalPlayerSession, PlayerContentInfo } from '@iptvnator/shared/interfaces';

@Injectable({
    providedIn: 'root',
})
export class ExternalPlaybackService {
    readonly activeSession = signal<ExternalPlayerSession | null>(null);
    private readonly dismissedSessionId = signal<string | null>(null);

    readonly visibleSession = computed(() => {
        const session = this.activeSession();
        if (
            !session ||
            session.status === 'closed' ||
            session.status === 'error'
        ) {
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

    async closeActiveSession(): Promise<void> {
        await this.closeSession(this.activeSession());
    }

    async closeSession(
        session: ExternalPlayerSession | null | undefined
    ): Promise<void> {
        if (!session) {
            return;
        }

        if (!session.canClose || !window.electron?.closeExternalPlayerSession) {
            this.dismissedSessionId.set(session.id);
            return;
        }

        const previousDismissedSessionId = this.dismissedSessionId();
        this.dismissedSessionId.set(session.id);

        try {
            const updatedSession = await window.electron.closeExternalPlayerSession(
                session.id
            );
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

        if (!current || current.id === session.id || session.status === 'launching') {
            this.activeSession.set(session);
        }

        if (session.status === 'launching') {
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
