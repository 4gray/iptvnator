import { signal } from '@angular/core';
import type {
    ExternalPlayerSession,
    ResolvedPortalPlayback,
} from '@iptvnator/shared/interfaces';
import type { ExternalLaunchOwner } from './vod-details-external-launch-owner';

interface OwnedExternalLaunchOptions {
    launch: Promise<ExternalPlayerSession | void>;
    owns: () => boolean;
    close: (session: ExternalPlayerSession) => Promise<void>;
    warnCloseFailure: (error: unknown) => void;
    /** The launch itself failed while nothing superseded it: the user's to hear about. */
    reportLaunchFailure?: (error: unknown) => void;
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
    } catch (error) {
        if (options.owns()) {
            options.reportLaunchFailure?.(error);
        }
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

/**
 * The MPV/VLC launch a VOD page made last and the one it still waits on.
 *
 * What was launched is remembered independently of the controller's active
 * source, so a refresh or an overlapping handoff cannot make the exact
 * process this page launched look foreign before its teardown has been
 * confirmed. Its route owner prevents a reused component from attributing
 * that process to a different movie.
 */
export class VodExternalLaunchClaim {
    private launchedGeneration = 0;
    /** Start generation of the launch still awaiting its player, if any. */
    readonly pendingGeneration = signal<number | null>(null);

    constructor(private readonly owner: ExternalLaunchOwner) {}

    claim(playback: ResolvedPortalPlayback, generation: number): void {
        this.owner.set(playback.contentInfo);
        this.launchedGeneration = generation;
        this.pendingGeneration.set(generation);
    }

    /** An inline start took over: nothing external is owned or awaited. */
    release(): void {
        this.owner.clear();
        this.pendingGeneration.set(null);
    }

    clearOwnership(generation: number): void {
        if (this.launchedGeneration === generation) {
            this.owner.clear();
        }
    }

    clearPending(generation: number): void {
        if (this.pendingGeneration() === generation) {
            this.pendingGeneration.set(null);
        }
    }
}
