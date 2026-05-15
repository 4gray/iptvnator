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
        return this.updateSession(id, { status: 'opened' });
    }

    markPlaying(id: string): ExternalPlayerSession | null {
        const current = this.getSession(id);
        if (!current || current.status === 'playing') {
            return current;
        }

        return this.updateSession(id, { status: 'playing' });
    }

    markClosed(id: string): ExternalPlayerSession | null {
        if (this.activeSessionId === id) {
            this.activeSessionId = null;
        }
        return this.updateSession(id, { status: 'closed', canClose: false });
    }

    markError(id: string, error: string): ExternalPlayerSession | null {
        return this.updateSession(id, {
            status: 'error',
            error,
            canClose: false,
        });
    }

    async closeSession(id: string): Promise<ExternalPlayerSession | null> {
        const runtime = this.sessions.get(id);
        if (!runtime) {
            return null;
        }

        try {
            await runtime.close?.();
        } finally {
            return this.markClosed(id);
        }
    }
}
