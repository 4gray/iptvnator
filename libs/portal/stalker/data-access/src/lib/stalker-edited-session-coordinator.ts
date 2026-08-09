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
    readonly configurationFingerprint: string;
    readonly sourceConfigurationFingerprint: string;
}

/** Serializes authoritative Edit results against pre-edit authentication. */
export class StalkerEditedSessionCoordinator {
    private readonly authoritativeConfigurations = new Map<string, string>();
    private readonly pendingEdits = new Map<string, PendingEdit>();
    private readonly replacements = new Map<string, Promise<Playlist>>();

    constructor(
        private readonly tokens: StalkerTokenCache,
        private readonly watchdog: StalkerWatchdogController,
        private readonly resolvePlaylistsService: () => PlaylistsService
    ) {}

    markAuthoritative(playlist: Playlist): string {
        const sessionFingerprint = stalkerSessionFingerprint(playlist);
        this.authoritativeConfigurations.set(
            playlist._id,
            stalkerConfigurationFingerprint(playlist, sessionFingerprint)
        );
        return sessionFingerprint;
    }

    async guard(playlist: Playlist): Promise<string> {
        const sessionFingerprint = stalkerSessionFingerprint(playlist);
        const configurationFingerprint = stalkerConfigurationFingerprint(
            playlist,
            sessionFingerprint
        );
        this.assertNoPendingEdit(playlist._id);
        const authoritative = this.authoritativeConfigurations.get(
            playlist._id
        );
        if (authoritative && authoritative !== configurationFingerprint) {
            await this.rebaseFromPersistedRow(
                playlist,
                configurationFingerprint
            );
        }
        // The persisted-row lookup yields. An Edit that acquired the ID while
        // it was in flight must still fence this request, even if the lookup
        // proved that the caller owned the row before Edit began.
        this.assertCurrent(playlist, sessionFingerprint);
        const replacement = this.replacements.get(playlist._id);
        if (replacement) {
            await replacement;
            this.assertCurrent(playlist, sessionFingerprint);
        }
        return sessionFingerprint;
    }

    assertCurrent(playlist: Playlist, sessionFingerprint: string): void {
        const playlistId = playlist._id;
        // A reservation blocks every new authentication, including a
        // text-only URL edit whose normalized session fingerprint is equal.
        this.assertNoPendingEdit(playlistId);
        if (stalkerSessionFingerprint(playlist) !== sessionFingerprint) {
            throw new Error('Stale Stalker playlist configuration');
        }
        const authoritative = this.authoritativeConfigurations.get(playlistId);
        if (
            authoritative &&
            authoritative !==
                stalkerConfigurationFingerprint(playlist, sessionFingerprint)
        ) {
            throw new Error('Stale Stalker playlist configuration');
        }
    }

    async beginEdit(
        playlist: Playlist,
        sourcePlaylist: Playlist = playlist
    ): Promise<StalkerEditFence> {
        const playlistId = playlist._id;
        if (sourcePlaylist._id !== playlistId) {
            throw new Error('Stale Stalker playlist configuration');
        }
        if (this.pendingEdits.has(playlistId)) {
            throw new Error('Stalker playlist edit already in progress');
        }
        const configurationFingerprint =
            stalkerConfigurationFingerprint(playlist);
        const fence = { playlistId, owner: Symbol('stalker-edit') };
        this.pendingEdits.set(playlistId, {
            owner: fence.owner,
            configurationFingerprint,
            sourceConfigurationFingerprint:
                stalkerConfigurationFingerprint(sourcePlaylist),
        });

        try {
            await this.replacements.get(playlistId)?.catch(() => undefined);
            this.assertFenceCurrent(fence, configurationFingerprint);
            await this.tokens
                .getPending(playlistId)
                ?.promise.catch(() => undefined);
            this.assertFenceCurrent(fence, configurationFingerprint);
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

    replace(
        playlist: Playlist,
        fence?: StalkerEditFence,
        options: { preserveCurrentMetadata?: boolean } = {}
    ): Promise<Playlist> {
        const playlistId = playlist._id;
        const sessionFingerprint = stalkerSessionFingerprint(playlist);
        const configurationFingerprint = stalkerConfigurationFingerprint(
            playlist,
            sessionFingerprint
        );
        const owner = fence?.owner ?? Symbol('stalker-edit');
        const pending = this.pendingEdits.get(playlistId);
        if (
            fence &&
            (fence.playlistId !== playlistId ||
                this.pendingEdits.get(playlistId)?.owner !== fence.owner)
        ) {
            return Promise.reject(
                new Error('Stale Stalker playlist configuration')
            );
        }
        const sourceConfigurationFingerprint =
            pending?.sourceConfigurationFingerprint ??
            stalkerConfigurationFingerprint(playlist);
        // Keep the same owner while discovery replaces its input-shaped
        // fingerprint with the resolved endpoint/mode fingerprint.
        this.pendingEdits.set(playlistId, {
            owner,
            configurationFingerprint,
            sourceConfigurationFingerprint,
        });
        const previous = this.replacements.get(playlistId) ?? Promise.resolve();
        const replacement = previous
            .catch(() => undefined)
            .then(() =>
                this.commit(
                    playlist,
                    sessionFingerprint,
                    configurationFingerprint,
                    owner,
                    sourceConfigurationFingerprint,
                    options
                )
            );
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
        sessionFingerprint: string,
        configurationFingerprint: string,
        owner: symbol,
        sourceConfigurationFingerprint: string,
        options: { preserveCurrentMetadata?: boolean }
    ): Promise<Playlist> {
        const playlistId = playlist._id;
        this.assertFenceCurrent(
            { playlistId, owner },
            configurationFingerprint
        );
        await this.tokens
            .getPending(playlistId)
            ?.promise.catch(() => undefined);
        this.assertFenceCurrent(
            { playlistId, owner },
            configurationFingerprint
        );

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
                stalkerSessionIdentity: sessionFingerprint,
                stalkerWatchdogTimeout: playlist.stalkerWatchdogTimeout,
                stalkerTimeslot: playlist.stalkerTimeslot,
                stalkerAccountInfo: playlist.stalkerAccountInfo,
            };
        }

        const persistedPlaylist = await firstValueFrom(
            options.preserveCurrentMetadata
                ? playlists.transformPlaylistMeta(playlistId, (current) =>
                      stalkerConfigurationFingerprint(current) ===
                      sourceConfigurationFingerprint
                          ? mergeResolvedStalkerConnection(
                                current,
                                playlist,
                                sessionPatch
                            )
                          : null
                  )
                : playlists.updatePlaylistMeta({
                      ...playlist,
                      stalkerSessionPatch: sessionPatch,
                  } as PlaylistMetaUpdate)
        );
        if (!persistedPlaylist) {
            throw new Error('Resolved Stalker playlist could not be persisted');
        }
        this.assertFenceCurrent(
            { playlistId, owner },
            configurationFingerprint
        );
        this.authoritativeConfigurations.set(
            playlistId,
            configurationFingerprint
        );
        if (this.pendingEdits.get(playlistId)?.owner === owner) {
            this.pendingEdits.delete(playlistId);
        }

        if (!sessionPatch) {
            this.tokens.clear(playlistId);
            return persistedPlaylist;
        }

        this.tokens.set(
            playlistId,
            sessionPatch.stalkerToken,
            sessionFingerprint
        );
        this.watchdog.applyProfileTiming(playlistId, {
            watchdogTimeoutSeconds: playlist.stalkerWatchdogTimeout,
            timeslotSeconds: playlist.stalkerTimeslot,
        });
        return persistedPlaylist;
    }

    private assertFenceCurrent(
        fence: StalkerEditFence,
        configurationFingerprint: string
    ): void {
        const pending = this.pendingEdits.get(fence.playlistId);
        if (
            !pending ||
            pending.owner !== fence.owner ||
            pending.configurationFingerprint !== configurationFingerprint
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
        configurationFingerprint: string
    ): Promise<void> {
        try {
            const persisted = await firstValueFrom(
                this.resolvePlaylistsService().getPlaylistById(playlist._id)
            );
            if (
                persisted &&
                stalkerConfigurationFingerprint(persisted) ===
                    configurationFingerprint
            ) {
                this.authoritativeConfigurations.set(
                    playlist._id,
                    configurationFingerprint
                );
                return;
            }
        } catch {
            // Preserve the stable stale-configuration error below. A failed
            // row read cannot prove that an external replacement owns the ID.
        }
        throw new Error('Stale Stalker playlist configuration');
    }
}

/** Applies remote connection authority without replaying stale form metadata. */
function mergeResolvedStalkerConnection(
    current: Playlist,
    resolved: Playlist,
    sessionPatch: PlaylistMetaUpdate['stalkerSessionPatch']
): Playlist {
    return {
        ...current,
        portalUrl: resolved.portalUrl,
        isFullStalkerPortal: resolved.isFullStalkerPortal,
        macAddress: resolved.macAddress,
        username: resolved.username,
        password: resolved.password,
        stalkerSerialNumber: resolved.stalkerSerialNumber,
        stalkerDeviceId1: resolved.stalkerDeviceId1,
        stalkerDeviceId2: resolved.stalkerDeviceId2,
        stalkerSignature1: resolved.stalkerSignature1,
        stalkerSignature2: resolved.stalkerSignature2,
        stalkerToken: sessionPatch?.stalkerToken,
        stalkerSessionIdentity: sessionPatch?.stalkerSessionIdentity,
        stalkerWatchdogTimeout: sessionPatch?.stalkerWatchdogTimeout,
        stalkerTimeslot: sessionPatch?.stalkerTimeslot,
        stalkerAccountInfo: sessionPatch?.stalkerAccountInfo,
    };
}

/** In-run Edit authority also owns the observed full/simple routing mode. */
function stalkerConfigurationFingerprint(
    playlist: Playlist,
    sessionFingerprint = stalkerSessionFingerprint(playlist)
): string {
    return JSON.stringify([
        sessionFingerprint,
        isFullStalkerPortalPlaylist(playlist),
    ]);
}
