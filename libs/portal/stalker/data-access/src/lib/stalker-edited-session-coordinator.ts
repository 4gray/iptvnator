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
    private readonly pendingFingerprints = new Map<string, string>();
    private readonly replacements = new Map<string, Promise<Playlist>>();

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
        const authoritative =
            this.pendingFingerprints.get(playlistId) ??
            this.authoritativeFingerprints.get(playlistId);
        if (authoritative && authoritative !== fingerprint) {
            throw new Error('Stale Stalker playlist configuration');
        }
    }

    replace(playlist: Playlist): Promise<Playlist> {
        const playlistId = playlist._id;
        const fingerprint = stalkerSessionFingerprint(playlist);
        // Fence the old connection immediately, but do not make the edit
        // authoritative until its single persistence write succeeds. A
        // failed write therefore releases this fence and leaves the prior
        // runtime session usable.
        this.pendingFingerprints.set(playlistId, fingerprint);
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
                if (this.pendingFingerprints.get(playlistId) === fingerprint) {
                    this.pendingFingerprints.delete(playlistId);
                }
            })
            .catch(() => undefined);
        return replacement;
    }

    private async commit(
        playlist: Playlist,
        fingerprint: string
    ): Promise<Playlist> {
        const playlistId = playlist._id;
        this.assertCurrent(playlistId, fingerprint);
        await this.tokens
            .getPending(playlistId)
            ?.promise.catch(() => undefined);
        this.assertCurrent(playlistId, fingerprint);

        const playlists = this.resolvePlaylistsService();
        const isFullPortal = isFullStalkerPortalPlaylist(playlist);
        let sessionPatch: PlaylistMetaUpdate['stalkerSessionPatch'] = null;
        if (isFullPortal) {
            const token = playlist.stalkerToken;
            if (!token) {
                throw new Error(
                    'Resolved full Stalker portal is missing a session token'
                );
            }
            sessionPatch = {
                stalkerToken: token,
                stalkerSessionIdentity: fingerprint,
                stalkerWatchdogTimeout: playlist.stalkerWatchdogTimeout,
                stalkerTimeslot: playlist.stalkerTimeslot,
                stalkerAccountInfo: playlist.stalkerAccountInfo,
            };
        }

        const persistedPlaylist = await firstValueFrom(
            playlists.updatePlaylistMeta({
                ...playlist,
                stalkerSessionPatch: sessionPatch,
            } as PlaylistMetaUpdate)
        );
        if (!persistedPlaylist) {
            throw new Error('Resolved Stalker playlist could not be persisted');
        }
        this.assertCurrent(playlistId, fingerprint);
        this.authoritativeFingerprints.set(playlistId, fingerprint);
        if (this.pendingFingerprints.get(playlistId) === fingerprint) {
            this.pendingFingerprints.delete(playlistId);
        }

        if (!sessionPatch) {
            this.tokens.clear(playlistId);
            return persistedPlaylist;
        }

        this.tokens.set(playlistId, sessionPatch.stalkerToken, fingerprint);
        this.watchdog.applyProfileTiming(playlistId, {
            watchdogTimeoutSeconds: playlist.stalkerWatchdogTimeout,
            timeslotSeconds: playlist.stalkerTimeslot,
        });
        return persistedPlaylist;
    }
}
