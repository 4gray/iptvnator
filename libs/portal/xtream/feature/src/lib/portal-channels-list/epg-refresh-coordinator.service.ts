import { Injectable, inject } from '@angular/core';
import {
    EpgQueueService,
    XtreamCredentials,
} from '@iptvnator/portal/xtream/data-access';
import { createLogger } from '@iptvnator/portal/shared/util';

/** How often the rows on screen re-check the programme they are showing. */
export const EPG_REFRESH_INTERVAL_MS = 60_000;

/** What one mounted channel list needs fetched, and the rows it is showing. */
export interface EpgRefreshContribution {
    readonly playlistId: string | null | undefined;
    readonly credentials: XtreamCredentials;
    /** Every row on screen, whether or not it needs anything. */
    readonly visibleStreamIds: readonly number[];
    readonly staleEntries: readonly {
        streamId: number;
        epgChannelId?: string | null;
        playlistId?: string | null;
    }[];
}

/** Credentials for the queue, from the playlist row the store holds. */
export function xtreamCredentialsOf(playlist: {
    serverUrl: string;
    username: string;
    password: string;
    serverTimezone?: string | null;
}): XtreamCredentials {
    return {
        serverUrl: playlist.serverUrl,
        username: playlist.username,
        password: playlist.password,
        serverTimezone: playlist.serverTimezone ?? undefined,
    };
}

/** One queue entry for a channel row. */
export function epgQueueEntryFor(
    channel: { xtream_id: number; epg_channel_id?: string | null },
    playlistId: string | null | undefined
) {
    return {
        streamId: channel.xtream_id,
        epgChannelId: channel.epg_channel_id ?? null,
        playlistId: playlistId ?? null,
    };
}

/** Returns what this list needs on a tick, or `null` when it needs nothing. */
export type EpgRefreshParticipant = () => EpgRefreshContribution | null;

/**
 * Owns the one timer behind the channel rows' periodic EPG refresh (#767) and
 * merges what every mounted list needs into a single queue request.
 *
 * A live layout mounts the channel list more than once — the sidebar and the
 * fullscreen channel panel render side by side — and `EpgQueueService.enqueue`
 * is latest-wins: it bumps one generation, replaces the queue and the visible
 * set, and drops an earlier caller's entries after its XMLTV await. Two lists
 * ticking on their own timers would therefore cancel each other whenever both
 * had rows to fill, which is exactly what happens on a programme boundary,
 * leaving one of them a minute behind. Rows that share a timer and one merged
 * request cannot.
 *
 * Each list still decides for itself what is stale — that part reads only its
 * own state and costs nothing — and contributes its whole visible slice, since
 * the queue drops anything outside the visible set it was last handed.
 */
@Injectable({ providedIn: 'root' })
export class EpgRefreshCoordinator {
    private readonly epgQueueService = inject(EpgQueueService);
    private readonly logger = createLogger('EpgRefreshCoordinator');
    private readonly participants = new Set<EpgRefreshParticipant>();
    private intervalId?: number;

    /** Joins the shared tick. Call the returned function on teardown. */
    register(participant: EpgRefreshParticipant): () => void {
        this.participants.add(participant);
        if (this.intervalId === undefined) {
            this.intervalId = window.setInterval(
                () => this.tick(),
                EPG_REFRESH_INTERVAL_MS
            );
        }

        return () => {
            this.participants.delete(participant);
            if (this.participants.size === 0 && this.intervalId !== undefined) {
                clearInterval(this.intervalId);
                this.intervalId = undefined;
            }
        };
    }

    private tick(): void {
        const contributions: EpgRefreshContribution[] = [];
        for (const participant of this.participants) {
            const contribution = participant();
            if (contribution) {
                contributions.push(contribution);
            }
        }

        // Lists of different playlists never share a queue request: the
        // credentials differ, and a stream id only means anything inside its
        // own account. In practice one live layout means one playlist.
        const byPlaylist = new Map<string, EpgRefreshContribution[]>();
        for (const contribution of contributions) {
            const key = contribution.playlistId ?? '';
            byPlaylist.set(key, [...(byPlaylist.get(key) ?? []), contribution]);
        }

        for (const group of byPlaylist.values()) {
            this.requestMerged(group);
        }
    }

    private requestMerged(group: EpgRefreshContribution[]): void {
        const visibleIds = new Set<number>();
        const entries = new Map<
            number,
            EpgRefreshContribution['staleEntries'][number]
        >();
        for (const contribution of group) {
            for (const streamId of contribution.visibleStreamIds) {
                visibleIds.add(streamId);
            }
            for (const entry of contribution.staleEntries) {
                // Both lists can show the same channel; it is fetched once.
                if (!entries.has(entry.streamId)) {
                    entries.set(entry.streamId, entry);
                }
            }
        }

        if (entries.size === 0) {
            return;
        }

        this.epgQueueService
            .enqueue([...entries.values()], visibleIds, group[0].credentials)
            .catch((error) => {
                this.logger.warn('EPG refresh enqueue failed', error);
            });
    }
}
