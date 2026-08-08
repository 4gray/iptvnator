import { firstValueFrom } from 'rxjs';
import {
    isFullStalkerPortalPlaylist,
    type Playlist,
    type PlaylistMetaUpdate,
} from '@iptvnator/shared/interfaces';
import type { PlaylistsService } from '@iptvnator/services';
import { stalkerSessionFingerprint } from './stalker-session-store';
import type { StalkerTokenCache } from './stalker-token-cache';
import type { StalkerWatchdogController } from './stalker-watchdog.controller';

/** Serializes authoritative Edit results against pre-edit authentication. */
export class StalkerEditedSessionCoordinator {
    private readonly authoritativeFingerprints = new Map<string, string>();
    private readonly replacements = new Map<string, Promise<void>>();

    constructor(
        private readonly tokens: StalkerTokenCache,
        private readonly watchdog: StalkerWatchdogController,
        private readonly resolvePlaylistsService: () => PlaylistsService
    ) {}

    markAuthoritative(playlist: Playlist): string {
        const fingerprint = stalkerSessionFingerprint(playlist);
        this.authoritativeFingerprints.set(playlist._id, fingerprint);
        return fingerprint;
    }

    async guard(playlist: Playlist): Promise<string> {
        const fingerprint = stalkerSessionFingerprint(playlist);
        this.assertCurrent(playlist._id, fingerprint);
        const replacement = this.replacements.get(playlist._id);
        if (replacement) {
            await replacement;
            this.assertCurrent(playlist._id, fingerprint);
        }
        return fingerprint;
    }

    assertCurrent(playlistId: string, fingerprint: string): void {
        const authoritative = this.authoritativeFingerprints.get(playlistId);
        if (authoritative && authoritative !== fingerprint) {
            throw new Error('Stale Stalker playlist configuration');
        }
    }

    replace(playlist: Playlist): Promise<void> {
        const playlistId = playlist._id;
        const fingerprint = this.markAuthoritative(playlist);
        const previous = this.replacements.get(playlistId) ?? Promise.resolve();
        const replacement = previous
            .catch(() => undefined)
            .then(() => this.commit(playlist, fingerprint));
        this.replacements.set(playlistId, replacement);
        void replacement
            .finally(() => {
                if (this.replacements.get(playlistId) === replacement) {
                    this.replacements.delete(playlistId);
                }
            })
            .catch(() => undefined);
        return replacement;
    }

    private async commit(
        playlist: Playlist,
        fingerprint: string
    ): Promise<void> {
        const playlistId = playlist._id;
        this.assertCurrent(playlistId, fingerprint);
        await this.tokens
            .getPending(playlistId)
            ?.promise.catch(() => undefined);
        this.assertCurrent(playlistId, fingerprint);

        const playlists = this.resolvePlaylistsService();
        if (!isFullStalkerPortalPlaylist(playlist)) {
            this.tokens.clear(playlistId);
            await firstValueFrom(
                playlists.updatePlaylistMeta({
                    ...playlist,
                    stalkerSessionPatch: null,
                } as PlaylistMetaUpdate)
            );
            return;
        }

        if (!playlist.stalkerToken) {
            throw new Error(
                'Resolved full Stalker portal is missing a session token'
            );
        }

        this.tokens.set(playlistId, playlist.stalkerToken, fingerprint);
        this.watchdog.applyProfileTiming(playlistId, {
            watchdogTimeoutSeconds: playlist.stalkerWatchdogTimeout,
            timeslotSeconds: playlist.stalkerTimeslot,
        });
        await firstValueFrom(
            playlists.updateStalkerSession(playlistId, {
                stalkerToken: playlist.stalkerToken,
                stalkerSessionIdentity: fingerprint,
                stalkerWatchdogTimeout: playlist.stalkerWatchdogTimeout,
                stalkerTimeslot: playlist.stalkerTimeslot,
            })
        );
    }
}
