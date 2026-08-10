import {
    ExternalPlayerName,
    ExternalPlayerSession,
    PlayerContentInfo,
} from '@iptvnator/shared/interfaces';

interface CreateExternalPlayerSessionOptions {
    player: ExternalPlayerName;
    title: string;
    thumbnail?: string | null;
    streamUrl: string;
    contentInfo?: PlayerContentInfo;
}

interface UpdateExternalPlayerSessionOptions {
    status?: ExternalPlayerSession['status'];
    error?: string;
    canClose?: boolean;
}

interface ExternalPlayerSessionRuntime {
    snapshot: ExternalPlayerSession;
    close?: () => Promise<void> | void;
}

interface MarkExternalPlayerSessionErrorOptions {
    canClose?: boolean;
}

function isRestorableSession(session: ExternalPlayerSession): boolean {
    return (
        session.status === 'launching' ||
        session.status === 'opened' ||
        session.status === 'playing' ||
        (session.status === 'error' && session.canClose)
    );
}

export class ExternalPlayerSessionRegistry {
    private readonly sessions = new Map<string, ExternalPlayerSessionRuntime>();
    private activeSessionId: string | null = null;

    constructor(
        private readonly onUpdate: (session: ExternalPlayerSession) => void
    ) {}

    beginSession(
        options: CreateExternalPlayerSessionOptions
    ): ExternalPlayerSession {
        const startedAt = new Date().toISOString();
        const session: ExternalPlayerSession = {
            id: crypto.randomUUID(),
            player: options.player,
            status: 'launching',
            title: options.title,
            thumbnail: options.thumbnail ?? null,
            streamUrl: options.streamUrl,
            contentInfo: options.contentInfo,
            startedAt,
            updatedAt: startedAt,
            canClose: false,
        };

        this.sessions.set(session.id, { snapshot: session });
        this.activeSessionId = session.id;
        this.onUpdate(session);
        return session;
    }

    getActiveSessionId(): string | null {
        return this.activeSessionId;
    }

    getSession(id: string): ExternalPlayerSession | null {
        return this.sessions.get(id)?.snapshot ?? null;
    }

    /**
     * Re-publish the exact still-live session that a failed replacement had
     * temporarily displaced. Its existing closer remains attached.
     */
    restoreActiveSession(
        id: string,
        displacedSessionId: string
    ): ExternalPlayerSession | null {
        const runtime = this.sessions.get(id);
        if (
            !runtime ||
            !isRestorableSession(runtime.snapshot) ||
            this.activeSessionId !== displacedSessionId
        ) {
            return null;
        }

        this.activeSessionId = id;
        this.onUpdate({
            ...runtime.snapshot,
            updatedAt: new Date().toISOString(),
            restoredFromSessionId: displacedSessionId,
        });
        return runtime.snapshot;
    }

    attachCloser(
        id: string,
        close: () => Promise<void> | void
    ): ExternalPlayerSession | null {
        const runtime = this.sessions.get(id);
        if (!runtime) {
            return null;
        }

        runtime.close = close;
        return this.updateSession(id, { canClose: true });
    }

    updateSession(
        id: string,
        options: UpdateExternalPlayerSessionOptions
    ): ExternalPlayerSession | null {
        const runtime = this.sessions.get(id);
        if (!runtime) {
            return null;
        }

        const next: ExternalPlayerSession = {
            ...runtime.snapshot,
            ...options,
            updatedAt: new Date().toISOString(),
        };
        runtime.snapshot = next;
        this.onUpdate(next);
        return next;
    }

    markOpened(id: string): ExternalPlayerSession | null {
        const current = this.getSession(id);
        if (!current || current.status !== 'launching') {
            return current;
        }
        return this.updateSession(id, { status: 'opened' });
    }

    markPlaying(id: string): ExternalPlayerSession | null {
        const current = this.getSession(id);
        if (
            !current ||
            current.status === 'playing' ||
            current.status === 'error' ||
            current.status === 'closed'
        ) {
            return current;
        }

        return this.updateSession(id, { status: 'playing' });
    }

    markClosed(id: string): ExternalPlayerSession | null {
        const current = this.getSession(id);
        if (!current || current.status === 'closed') {
            return current;
        }
        if (this.activeSessionId === id) {
            this.activeSessionId = null;
        }
        return this.updateSession(id, { status: 'closed', canClose: false });
    }

    markError(
        id: string,
        error: string,
        options: MarkExternalPlayerSessionErrorOptions = {}
    ): ExternalPlayerSession | null {
        const current = this.getSession(id);
        if (!current || current.status === 'closed') {
            return current;
        }

        return this.updateSession(id, {
            status: 'error',
            error,
            canClose: options.canClose ?? false,
        });
    }

    async closeSession(id: string): Promise<ExternalPlayerSession | null> {
        const runtime = this.sessions.get(id);
        if (!runtime) {
            return null;
        }

        // A renderer can deliver a delayed duplicate Stop after the exact
        // child has already exited and a newer external player owns the
        // process slot. Never re-enter the terminal session's saved closer:
        // its protocol endpoint may since have been reused by another child.
        if (runtime.snapshot.status === 'closed') {
            return runtime.snapshot;
        }

        // A failed closer cannot prove that the underlying process stopped.
        // Preserve the live session and propagate the failure so callers do
        // not start a replacement process alongside it.
        await runtime.close?.();

        return this.markClosed(id);
    }
}
