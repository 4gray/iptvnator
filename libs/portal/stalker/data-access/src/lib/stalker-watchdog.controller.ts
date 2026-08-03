import {
    isFullStalkerPortalPlaylist,
    type Playlist,
} from '@iptvnator/shared/interfaces';
import type { createLogger } from '@iptvnator/portal/shared/util';

/**
 * The portal expects `get_events` every `watchdog_timeout` seconds — 120 by
 * default — not every 25 s as the client historically pinged.
 */
export const STALKER_WATCHDOG_DEFAULT_PERIOD_SECONDS = 120;

/** Guard rails for a garbage `watchdog_timeout` echoed by a broken panel. */
const MIN_PERIOD_SECONDS = 30;
const MAX_PERIOD_SECONDS = 3600;

export interface StalkerWatchdogTiming {
    periodSeconds: number;
    /** Per-user jitter: delays the first periodic ping so clients spread out. */
    timeslotSeconds: number;
}

export interface StalkerWatchdogDeps {
    /** Sends one authenticated `get_events` ping. */
    sendRequest: (
        playlist: Playlist,
        params: Record<string, string | number>
    ) => Promise<unknown>;
    /**
     * Reads the persisted row for a playlist. The row is the source of truth
     * for the configuration a ping authenticates as; see `resolvePlaylist`.
     */
    readPersistedPlaylist: (playlistId: string) => Promise<Playlist | undefined>;
    logger: ReturnType<typeof createLogger>;
}

interface WatchdogTimers {
    timeslotTimeout?: ReturnType<typeof setTimeout>;
    interval?: ReturnType<typeof setInterval>;
}

/**
 * Keeps the active full portal's session "online" by pinging `get_events`.
 *
 * The cadence comes from the profile (`watchdog_timeout` + `timeslot`); until
 * a profile has been decoded the documented default of 120 s applies. A missed
 * ping never invalidates authentication — it only affects the portal's
 * "online" reporting — so failures are logged and never retried or escalated.
 */
export class StalkerWatchdogController {
    private readonly timers = new Map<string, WatchdogTimers>();
    /** Activation-time snapshot; only a fallback when the row cannot be read. */
    private readonly playlists = new Map<string, Playlist>();
    private readonly inFlight = new Set<string>();
    /** Survives stop/start: the cadence is a per-portal fact, not session state. */
    private readonly timings = new Map<string, StalkerWatchdogTiming>();
    private activePlaylistId: string | null = null;
    private playlistDecorator: ((playlist: Playlist) => Playlist) | null = null;

    constructor(private readonly deps: StalkerWatchdogDeps) {}

    /**
     * Sets which playlist should receive periodic watchdog pings.
     * This keeps some Ministra/Stalker sessions alive for live playback.
     */
    setActivePlaylist(playlist?: Playlist | null): void {
        const nextPlaylistId = playlist?._id ?? null;

        if (this.activePlaylistId && this.activePlaylistId !== nextPlaylistId) {
            this.stop(this.activePlaylistId);
        }

        this.activePlaylistId = nextPlaylistId;

        if (
            !playlist ||
            !isFullStalkerPortalPlaylist(playlist) ||
            !playlist.portalUrl ||
            !playlist.macAddress
        ) {
            if (nextPlaylistId) {
                this.stop(nextPlaylistId);
            }
            return;
        }

        this.start(playlist);
    }

    /** Whether this playlist currently owns the watchdog. */
    isActivePlaylist(playlistId: string): boolean {
        return this.activePlaylistId === playlistId;
    }

    /**
     * Lets the repair layer overlay its in-session override on the row a ping
     * resolves: the persisted row can still carry a pre-repair configuration
     * while persistence is pending (or failed), and pinging that would stop
     * or misdirect the keepalive.
     */
    registerPlaylistDecorator(decorator: (playlist: Playlist) => Playlist): void {
        this.playlistDecorator = decorator;
    }

    /**
     * Applies the cadence decoded from a `get_profile` response. When the
     * playlist's watchdog is already running on a different cadence, its
     * periodic schedule restarts (without re-sending the init ping).
     */
    applyProfileTiming(
        playlistId: string,
        timing: { watchdogTimeoutSeconds?: number; timeslotSeconds?: number }
    ): void {
        const next = normalizeTiming(timing);
        const current = this.timings.get(playlistId);
        if (
            current &&
            current.periodSeconds === next.periodSeconds &&
            current.timeslotSeconds === next.timeslotSeconds
        ) {
            return;
        }

        this.timings.set(playlistId, next);

        if (this.timers.has(playlistId)) {
            this.clearTimers(playlistId);
            this.timers.set(playlistId, {});
            this.schedule(playlistId);
        }
    }

    private start(playlist: Playlist): void {
        const playlistId = playlist._id;
        this.playlists.set(playlistId, playlist);

        if (this.timers.has(playlistId)) {
            return;
        }

        this.timers.set(playlistId, {});
        void this.sendPing(playlistId, '1');
        this.schedule(playlistId);
    }

    private stop(playlistId: string): void {
        this.clearTimers(playlistId);
        this.timers.delete(playlistId);
        this.playlists.delete(playlistId);
        this.inFlight.delete(playlistId);
    }

    private clearTimers(playlistId: string): void {
        const timers = this.timers.get(playlistId);
        if (!timers) {
            return;
        }
        if (timers.timeslotTimeout) {
            clearTimeout(timers.timeslotTimeout);
        }
        if (timers.interval) {
            clearInterval(timers.interval);
        }
    }

    private timingFor(playlistId: string): StalkerWatchdogTiming {
        return (
            this.timings.get(playlistId) ?? {
                periodSeconds: STALKER_WATCHDOG_DEFAULT_PERIOD_SECONDS,
                timeslotSeconds: 0,
            }
        );
    }

    private schedule(playlistId: string): void {
        const timers = this.timers.get(playlistId);
        if (!timers) {
            return;
        }

        const { periodSeconds, timeslotSeconds } = this.timingFor(playlistId);
        const startInterval = () => {
            const current = this.timers.get(playlistId);
            if (!current) {
                return;
            }
            current.timeslotTimeout = undefined;
            current.interval = setInterval(() => {
                void this.sendPing(playlistId, '0');
            }, periodSeconds * 1000);
        };

        if (timeslotSeconds > 0) {
            timers.timeslotTimeout = setTimeout(
                startInterval,
                timeslotSeconds * 1000
            );
        } else {
            startInterval();
        }
    }

    /**
     * The playlist a ping authenticates as. The persisted row is the source of
     * truth: portal metadata (endpoint, mode, MAC, identity) edited or
     * repaired mid-session must reach the keepalive within one cycle — the
     * activation-time snapshot is only the fallback when the row cannot be
     * read.
     */
    private async resolvePlaylist(
        playlistId: string
    ): Promise<Playlist | undefined> {
        try {
            const row = await this.deps.readPersistedPlaylist(playlistId);
            if (row) {
                // Keep the fallback snapshot fresh for the next cycle.
                this.playlists.set(playlistId, row);
                return this.decorate(row);
            }
        } catch {
            // Store unavailable (e.g. isolated tests): keep the snapshot.
        }

        const snapshot = this.playlists.get(playlistId);
        return snapshot ? this.decorate(snapshot) : snapshot;
    }

    private decorate(playlist: Playlist): Playlist {
        return this.playlistDecorator
            ? this.playlistDecorator(playlist)
            : playlist;
    }

    private async sendPing(playlistId: string, init: '0' | '1'): Promise<void> {
        if (this.inFlight.has(playlistId)) {
            return;
        }

        // Claimed BEFORE the row read: it awaits, and two overlapping pings
        // passing the check together would double-fire the keepalive.
        this.inFlight.add(playlistId);
        try {
            const playlist = await this.resolvePlaylist(playlistId);
            if (
                !playlist ||
                !playlist.portalUrl ||
                !playlist.macAddress ||
                !isFullStalkerPortalPlaylist(playlist)
            ) {
                this.stop(playlistId);
                return;
            }

            await this.deps.sendRequest(playlist, {
                type: 'watchdog',
                action: 'get_events',
                event_active_id: '0',
                cur_play_type: '0',
                init,
                JsHttpRequest: '1-xml',
            });
        } catch (error) {
            // Keep failures non-fatal; the next tick can recover after a
            // token refresh. Never retry or escalate: a missed ping does not
            // invalidate authentication.
            this.deps.logger.warn('Watchdog ping failed:', error);
        } finally {
            this.inFlight.delete(playlistId);
        }
    }
}

function normalizeTiming(timing: {
    watchdogTimeoutSeconds?: number;
    timeslotSeconds?: number;
}): StalkerWatchdogTiming {
    const period = clamp(
        Math.floor(
            timing.watchdogTimeoutSeconds ??
                STALKER_WATCHDOG_DEFAULT_PERIOD_SECONDS
        ),
        MIN_PERIOD_SECONDS,
        MAX_PERIOD_SECONDS
    );
    const timeslot = clamp(Math.floor(timing.timeslotSeconds ?? 0), 0, period - 1);
    return { periodSeconds: period, timeslotSeconds: timeslot };
}

function clamp(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) {
        return min;
    }
    return Math.min(Math.max(value, min), max);
}
