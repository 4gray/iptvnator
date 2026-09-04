/**
 * Thrown by an engine adapter when a session can no longer take commands
 * because the process behind it is gone (a crashed frame-copy helper). The
 * reconnect coordinator treats it as terminal: only a new session can
 * recover, so retrying the same session would just spin.
 */
export class EmbeddedMpvSessionGoneError extends Error {
    constructor(sessionId: string, reason: string) {
        super(
            `Embedded MPV session "${sessionId}" cannot be reused: ${reason}.`
        );
        this.name = 'EmbeddedMpvSessionGoneError';
    }
}

export function isEmbeddedMpvSessionGoneError(error: unknown): boolean {
    return (
        error instanceof Error && error.name === 'EmbeddedMpvSessionGoneError'
    );
}
