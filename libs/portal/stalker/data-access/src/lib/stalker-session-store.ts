import { firstValueFrom } from 'rxjs';
import type { Playlist } from '@iptvnator/shared/interfaces';
import type { PlaylistsService } from '@iptvnator/services';
import type { createLogger } from '@iptvnator/portal/shared/util';
import { STALKER_WATCHDOG_DEFAULT_PERIOD_SECONDS } from './stalker-watchdog.controller';
import { stalkerIdentityFingerprint } from './stalker-identity.utils';
import type { StalkerAuthenticationResult } from './stalker-auth.api';

/**
 * Everything a Stalker session is bound to: the endpoint it was negotiated
 * against, the device identity, and the account credentials.
 *
 * All three halves matter, and each was a real defect when missing:
 *
 * - **Endpoint** — `ensureToken()` re-presents tokens in a handshake, so a
 *   playlist repointed at another portal would disclose the previous one's
 *   bearer token to it. Origin alone is not enough: discovery deliberately
 *   preserves tenant base paths (`/tenant-a/…` vs `/tenant-b/…`), which are
 *   different portals on one host. URL Basic-auth credentials are part of
 *   the endpoint authority too: an edited userinfo identity must not receive
 *   a token negotiated through the previous one.
 * - **Identity** — an edited MAC/serial must not inherit the old session.
 * - **Credentials** — for a status-2 portal the login decides which account
 *   the token represents, so changing it must not keep serving the previous
 *   account's session.
 *
 * Used for BOTH the in-run cache and the persisted session: an edit applies
 * without waiting for a restart.
 */
export function stalkerSessionFingerprint(
    playlist: Pick<
        Playlist,
        | 'portalUrl'
        | 'macAddress'
        | 'username'
        | 'password'
        | 'stalkerSerialNumber'
        | 'stalkerDeviceId1'
        | 'stalkerDeviceId2'
        | 'stalkerSignature1'
        | 'stalkerSignature2'
    >
): string {
    return JSON.stringify([
        portalEndpoint(playlist.portalUrl),
        stalkerIdentityFingerprint(playlist as Playlist),
        playlist.username ?? '',
        playlist.password ?? '',
    ]);
}

/**
 * Origin AND path, minus query/fragment — the endpoint a session belongs to.
 *
 * No attempt is made to treat different handler paths for the same portal
 * (`…/portal.php` vs `…/server/load.php`) as equivalent. Both sides of the
 * comparison read the SAME persisted `portalUrl`, so the same portal always
 * yields the same key; the value changes only on a real edit or repair, and
 * both of those re-authenticate anyway. An equivalence rule would add
 * machinery whose only failure mode is aliasing two genuinely different
 * endpoints — the exact thing this key exists to prevent.
 */
function portalEndpoint(portalUrl: string | undefined): string {
    if (!portalUrl) {
        return '';
    }
    try {
        const parsed = new URL(portalUrl);
        const endpoint = `${parsed.origin}${parsed.pathname.replace(
            /\/+$/,
            ''
        )}`;

        // URL.origin deliberately omits userinfo. Preserve the legacy value
        // for ordinary endpoints so an upgrade does not invalidate healthy
        // sessions, while Basic-auth URLs bind the token to the exact accepted
        // credentials. JSON avoids ambiguous delimiter collisions.
        return parsed.username || parsed.password
            ? JSON.stringify([endpoint, parsed.username, parsed.password])
            : endpoint;
    } catch {
        // Unparseable: fall back to the raw string so a change is still a
        // change — never to a constant, which would alias every endpoint.
        return portalUrl;
    }
}

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

        // A token with NO recorded fingerprint is unverified, not trusted:
        // playlists written before the fingerprint existed carry one, and
        // re-presenting it after an endpoint or identity edit is exactly the
        // disclosure the fingerprint prevents. Such a row has no cadence
        // either, so it already owes a full profile — refusing the token
        // costs it nothing, and the write-back then records the fingerprint.
        if (stored.token && stored.identityFingerprint !== fingerprint) {
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
     * Propagates a successful authentication into session-side state: the
     * watchdog cadence, and the write-back.
     *
     * Reusing a stored token skips the `get_profile` that carries the
     * cadence, so the persisted cadence is applied instead — otherwise a
     * portal advertising a non-default `watchdog_timeout` would sit on the
     * 120 s fallback for the whole session.
     */
    applyAuthenticationOutcome(
        playlistId: string,
        result: StalkerAuthenticationResult,
        stored: PersistedStalkerSession,
        fingerprint: string,
        watchdog: {
            applyProfileTiming: (
                playlistId: string,
                timing: {
                    watchdogTimeoutSeconds?: number;
                    timeslotSeconds?: number;
                }
            ) => void;
        }
    ): void {
        if (result.reusedStoredToken) {
            watchdog.applyProfileTiming(playlistId, {
                watchdogTimeoutSeconds: stored.watchdogTimeoutSeconds,
                timeslotSeconds: stored.timeslotSeconds,
            });
            return;
        }

        watchdog.applyProfileTiming(playlistId, {
            watchdogTimeoutSeconds: result.watchdogTimeoutSeconds,
            timeslotSeconds: result.timeslotSeconds,
        });
        this.write(playlistId, result, stored, fingerprint);
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
