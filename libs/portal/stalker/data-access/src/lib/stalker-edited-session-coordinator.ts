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

/** Opaque ownership proof for one discovery-to-persistence Edit attempt. */
export interface StalkerEditFence {
    readonly playlistId: string;
    readonly owner: symbol;
}

interface PendingEdit {
    readonly owner: symbol;
    readonly fingerprint: string;
}

/** Serializes authoritative Edit results against pre-edit authentication. */
export class StalkerEditedSessionCoordinator {
    private readonly authoritativeFingerprints = new Map<string, string>();
    private readonly pendingEdits = new Map<string, PendingEdit>();
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
        this.assertNoPendingEdit(playlist._id);
        const authoritative = this.authoritativeFingerprints.get(playlist._id);
        if (authoritative && authoritative !== fingerprint) {
            await this.rebaseFromPersistedRow(playlist, fingerprint);
        }
        // The persisted-row lookup yields. An Edit that acquired the ID while
        // it was in flight must still fence this request, even if the lookup
        // proved that the caller owned the row before Edit began.
        this.assertCurrent(playlist._id, fingerprint);
        const replacement = this.replacements.get(playlist._id);
        if (replacement) {
            await replacement;
            this.assertCurrent(playlist._id, fingerprint);
        }
        return fingerprint;
    }

    assertCurrent(playlistId: string, fingerprint: string): void {
        // A reservation blocks every new authentication, including a
        // text-only URL edit whose normalized session fingerprint is equal.
        this.assertNoPendingEdit(playlistId);
        const authoritative = this.authoritativeFingerprints.get(playlistId);
        if (authoritative && authoritative !== fingerprint) {
            throw new Error('Stale Stalker playlist configuration');
        }
    }

    async beginEdit(playlist: Playlist): Promise<StalkerEditFence> {
        const playlistId = playlist._id;
        if (this.pendingEdits.has(playlistId)) {
            throw new Error('Stalker playlist edit already in progress');
        }
        const fingerprint = stalkerSessionFingerprint(playlist);
        const fence = { playlistId, owner: Symbol('stalker-edit') };
        this.pendingEdits.set(playlistId, {
            owner: fence.owner,
            fingerprint,
        });

        try {
            await this.replacements.get(playlistId)?.catch(() => undefined);
            this.assertFenceCurrent(fence, fingerprint);
            await this.tokens
                .getPending(playlistId)
                ?.promise.catch(() => undefined);
            this.assertFenceCurrent(fence, fingerprint);
            return fence;
        } catch (error) {
            this.cancelEdit(fence);
            throw error;
        }
    }

    cancelEdit(fence: StalkerEditFence): void {
        if (this.pendingEdits.get(fence.playlistId)?.owner === fence.owner) {
            this.pendingEdits.delete(fence.playlistId);
        }
    }

    replace(playlist: Playlist, fence?: StalkerEditFence): Promise<Playlist> {
        const playlistId = playlist._id;
        const fingerprint = stalkerSessionFingerprint(playlist);
        const owner = fence?.owner ?? Symbol('stalker-edit');
        if (
            fence &&
            (fence.playlistId !== playlistId ||
                this.pendingEdits.get(playlistId)?.owner !== fence.owner)
        ) {
            return Promise.reject(
                new Error('Stale Stalker playlist configuration')
            );
        }
        // Keep the same owner while discovery replaces its input-shaped
        // fingerprint with the resolved endpoint/mode fingerprint.
        this.pendingEdits.set(playlistId, { owner, fingerprint });
        const previous = this.replacements.get(playlistId) ?? Promise.resolve();
        const replacement = previous
            .catch(() => undefined)
            .then(() => this.commit(playlist, fingerprint, owner));
        this.replacements.set(playlistId, replacement);
        void replacement
            .finally(() => {
                if (this.replacements.get(playlistId) === replacement) {
                    this.replacements.delete(playlistId);
                }
                if (this.pendingEdits.get(playlistId)?.owner === owner) {
                    this.pendingEdits.delete(playlistId);
                }
            })
            .catch(() => undefined);
        return replacement;
    }

    private async commit(
        playlist: Playlist,
        fingerprint: string,
        owner: symbol
    ): Promise<Playlist> {
        const playlistId = playlist._id;
        this.assertFenceCurrent({ playlistId, owner }, fingerprint);
        await this.tokens
            .getPending(playlistId)
            ?.promise.catch(() => undefined);
        this.assertFenceCurrent({ playlistId, owner }, fingerprint);

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
        this.assertFenceCurrent({ playlistId, owner }, fingerprint);
        this.authoritativeFingerprints.set(playlistId, fingerprint);
        if (this.pendingEdits.get(playlistId)?.owner === owner) {
            this.pendingEdits.delete(playlistId);
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

    private assertFenceCurrent(
        fence: StalkerEditFence,
        fingerprint: string
    ): void {
        const pending = this.pendingEdits.get(fence.playlistId);
        if (
            !pending ||
            pending.owner !== fence.owner ||
            pending.fingerprint !== fingerprint
        ) {
            throw new Error('Stale Stalker playlist configuration');
        }
    }

    private assertNoPendingEdit(playlistId: string): void {
        if (this.pendingEdits.has(playlistId)) {
            throw new Error('Stale Stalker playlist configuration');
        }
    }

    private async rebaseFromPersistedRow(
        playlist: Playlist,
        fingerprint: string
    ): Promise<void> {
        try {
            const persisted = await firstValueFrom(
                this.resolvePlaylistsService().getPlaylistById(playlist._id)
            );
            if (
                persisted &&
                stalkerSessionFingerprint(persisted) === fingerprint
            ) {
                this.authoritativeFingerprints.set(playlist._id, fingerprint);
                return;
            }
        } catch {
            // Preserve the stable stale-configuration error below. A failed
            // row read cannot prove that an external replacement owns the ID.
        }
        throw new Error('Stale Stalker playlist configuration');
    }
}
