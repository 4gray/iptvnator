export interface StalkerPendingAuth {
    promise: Promise<{ token: string; serialNumber?: string }>;
    identityFingerprint: string;
}

/**
 * In-memory session state for the current app run, keyed by playlist ID and
 * tagged with the identity fingerprint the session was negotiated for.
 *
 * The tagging is the point: a playlist whose endpoint, identity or login was
 * edited must never inherit the previous session — neither the cached token
 * nor an authentication still in flight for the old one. The key comes from
 * `stalkerSessionFingerprint`, so an edit applies without a restart.
 */
export class StalkerTokenCache {
    private readonly tokens = new Map<
        string,
        { token: string; identityFingerprint: string }
    >();
    private readonly pending = new Map<string, StalkerPendingAuth>();

    /**
     * The cached token regardless of identity. Playback fast paths that
     * cannot supply an identity use this; `takeFor` is the checked accessor.
     */
    get(playlistId: string): string | null {
        return this.tokens.get(playlistId)?.token || null;
    }

    set(playlistId: string, token: string, sessionFingerprint: string): void {
        this.tokens.set(playlistId, {
            token,
            identityFingerprint: sessionFingerprint,
        });
    }

    clear(playlistId: string): void {
        this.tokens.delete(playlistId);
    }

    /**
     * The cached token when it was negotiated for this exact identity. A
     * mismatch retires the entry and returns null, so the caller
     * authenticates as the current identity instead of pairing a new one
     * with an old session.
     */
    takeFor(playlistId: string, fingerprint: string): string | null {
        const cached = this.tokens.get(playlistId);
        if (!cached) {
            return null;
        }
        if (cached.identityFingerprint === fingerprint) {
            return cached.token;
        }

        this.clear(playlistId);
        return null;
    }

    /**
     * Clears the cached token only while it is still the one that just
     * failed. A request dispatched with the previous token can see its
     * authorization failure arrive after a profile refresh has already
     * cached a fresh token — deleting blindly would kill that fresh token
     * and trigger a cascade of competing handshakes on strict portals.
     */
    retireFailed(playlistId: string, failedToken: string | null): void {
        if (failedToken && this.get(playlistId) === failedToken) {
            this.clear(playlistId);
        }
    }

    getPending(playlistId: string): StalkerPendingAuth | undefined {
        return this.pending.get(playlistId);
    }

    setPending(playlistId: string, entry: StalkerPendingAuth): void {
        this.pending.set(playlistId, entry);
    }

    clearPending(playlistId: string): void {
        this.pending.delete(playlistId);
    }

    /** Retires the pending slot only when it is still the caller's own. */
    clearPendingIf(playlistId: string, entry: StalkerPendingAuth): void {
        if (this.pending.get(playlistId) === entry) {
            this.pending.delete(playlistId);
        }
    }
}
