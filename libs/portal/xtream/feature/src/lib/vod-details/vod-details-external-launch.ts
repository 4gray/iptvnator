import type { ExternalPlayerSession } from '@iptvnator/shared/interfaces';

interface OwnedExternalLaunchOptions {
    launch: Promise<ExternalPlayerSession | void>;
    owns: () => boolean;
    close: (session: ExternalPlayerSession) => Promise<void>;
    warnCloseFailure: (error: unknown) => void;
    clearPending: () => void;
    clearOwnership: () => void;
}

/** Settles an exact MPV/VLC launch without letting stale results take ownership. */
export async function settleOwnedExternalLaunch(
    options: OwnedExternalLaunchOptions
): Promise<boolean> {
    try {
        const launched = await options.launch;
        const accepted =
            launched?.status === 'opened' || launched?.status === 'playing';

        if (accepted && options.owns()) {
            options.clearPending();
            return true;
        }

        if (isClosableExternalLaunch(launched)) {
            try {
                await options.close(launched);
            } catch (error) {
                options.warnCloseFailure(error);
                // The exact child is still potentially live. Keep the
                // credential-free destination owner so the next source start
                // can retry its close instead of depending on the global dock.
                options.clearPending();
                return false;
            }
        }
        options.clearPending();
        options.clearOwnership();
        return false;
    } catch {
        // A partial reuse can reject while Electron retains a matching
        // closable error session. Keep its credential-free identity so the
        // next source start can still find and close that exact process.
        options.clearPending();
        return false;
    }
}

function isClosableExternalLaunch(
    session: ExternalPlayerSession | void
): session is ExternalPlayerSession {
    return (
        !!session &&
        (session.status === 'launching' ||
            session.status === 'opened' ||
            session.status === 'playing' ||
            (session.status === 'error' && session.canClose))
    );
}
