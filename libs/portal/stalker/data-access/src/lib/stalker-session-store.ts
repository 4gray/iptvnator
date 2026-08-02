import { firstValueFrom } from 'rxjs';
import type { Playlist } from '@iptvnator/shared/interfaces';
import type { PlaylistsService } from '@iptvnator/services';
import type { createLogger } from '@iptvnator/portal/shared/util';
import { STALKER_WATCHDOG_DEFAULT_PERIOD_SECONDS } from './stalker-watchdog.controller';
import type { StalkerAuthenticationResult } from './stalker-auth.api';

/**
 * Session facts persisted with the playlist between app starts.
 *
 * `identityFingerprint` is what makes the token safe to re-present: it records
 * the identity the session was negotiated for, so an edited MAC or serial
 * cannot inherit the previous session.
 */
export interface PersistedStalkerSession {
    token?: string;
    identityFingerprint?: string;
    watchdogTimeoutSeconds?: number;
    timeslotSeconds?: number;
}

/**
 * Reads and writes the Stalker session persisted on the playlist row.
 *
 * Kept out of the session service because it is the only part that needs the
 * persistence stack, which is resolved lazily: the service is constructed
 * during bootstrap, and pulling `PlaylistsService` in eagerly would both
 * widen its dependency graph and risk a DI cycle.
 */
export class StalkerSessionStore {
    constructor(
        private readonly resolvePlaylistsService: () => PlaylistsService,
        private readonly logger: ReturnType<typeof createLogger>
    ) {}

    /** Reads a playlist row through the lazily-resolved persistence stack. */
    async readRow(playlistId: string): Promise<Playlist | undefined> {
        const row = await firstValueFrom(
            this.resolvePlaylistsService().getPlaylistById(playlistId)
        );
        return (row as Playlist) ?? undefined;
    }

    /**
     * Reads the session persisted with the playlist: the token, the identity
     * it was negotiated for, and the watchdog cadence the portal advertised.
     *
     * The token is only offered for reuse when its identity still matches —
     * re-presenting one minted for an edited MAC would pair a new identity
     * with an old session, exactly what the in-memory cache guards against.
     */
    async read(
        playlist: Playlist,
        fingerprint: string
    ): Promise<PersistedStalkerSession> {
        const fromPlaylist: PersistedStalkerSession = {
            token: playlist.stalkerToken || undefined,
            identityFingerprint: playlist.stalkerSessionIdentity,
            watchdogTimeoutSeconds: playlist.stalkerWatchdogTimeout,
            timeslotSeconds: playlist.stalkerTimeslot,
        };

        // Shortcut only when the object carries the cadence too. Taking it on
        // the token alone would silently drop a persisted cadence for any
        // playlist shape that copies the token without the timing fields.
        const stored =
            fromPlaylist.token &&
            fromPlaylist.watchdogTimeoutSeconds !== undefined
                ? fromPlaylist
                : await this.readFromRow(playlist, fromPlaylist);

        if (
            stored.token &&
            stored.identityFingerprint !== undefined &&
            stored.identityFingerprint !== fingerprint
        ) {
            // Minted for a different identity — negotiate a fresh session.
            return { ...stored, token: undefined };
        }

        return stored;
    }

    private async readFromRow(
        playlist: Playlist,
        fallback: PersistedStalkerSession
    ): Promise<PersistedStalkerSession> {
        try {
            const stored = await this.readRow(playlist._id);
            return {
                // The row is authoritative, but a meta that carried a token
                // the row has not seen yet must not lose it.
                token: stored?.stalkerToken || fallback.token,
                identityFingerprint:
                    stored?.stalkerSessionIdentity ??
                    fallback.identityFingerprint,
                watchdogTimeoutSeconds: stored?.stalkerWatchdogTimeout,
                timeslotSeconds: stored?.stalkerTimeslot,
            };
        } catch (error) {
            this.logger.debug('Persisted session lookup failed:', error);
            return fallback;
        }
    }

    /**
     * Writes a renegotiated session back, best effort.
     *
     * The EFFECTIVE cadence is stored, not the raw one: a portal that
     * advertises nothing must still leave a value behind, or "no cadence
     * stored" would keep meaning "never profiled" and every start would
     * re-profile it. Stored absence therefore means exactly one thing — this
     * playlist has never completed a profile.
     *
     * Returns the cadence that was applied, so the caller can drive the
     * watchdog with the same numbers.
     */
    write(
        playlistId: string,
        result: StalkerAuthenticationResult,
        stored: PersistedStalkerSession,
        fingerprint: string
    ): void {
        const watchdogTimeout =
            result.watchdogTimeoutSeconds ??
            STALKER_WATCHDOG_DEFAULT_PERIOD_SECONDS;
        const timeslot = result.timeslotSeconds ?? 0;
        const changed =
            result.token !== stored.token ||
            fingerprint !== stored.identityFingerprint ||
            watchdogTimeout !== stored.watchdogTimeoutSeconds ||
            timeslot !== stored.timeslotSeconds;

        if (!changed) {
            return;
        }

        try {
            void firstValueFrom(
                this.resolvePlaylistsService().updateStalkerSession(
                    playlistId,
                    {
                        stalkerToken: result.token,
                        stalkerSessionIdentity: fingerprint,
                        stalkerWatchdogTimeout: watchdogTimeout,
                        stalkerTimeslot: timeslot,
                    }
                )
            ).catch((error) => {
                this.logger.debug('Session write-back failed:', error);
            });
        } catch (error) {
            // Persistence stack unavailable (e.g. isolated tests, or a DI
            // cycle at this point in bootstrap). The session still works for
            // this run; only the cross-restart reuse is lost.
            this.logger.debug('Session write-back unavailable:', error);
        }
    }
}
