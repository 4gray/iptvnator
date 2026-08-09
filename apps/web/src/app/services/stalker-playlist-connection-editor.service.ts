import { inject, Injectable } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import {
    asStalkerPortalError,
    StalkerPortalDiscoveryService,
    StalkerPortalRepairService,
    StalkerSessionService,
    StalkerStore,
    STALKER_WATCHDOG_DEFAULT_PERIOD_SECONDS,
    stalkerSessionFingerprint,
    type StalkerPortalErrorKind,
} from '@iptvnator/portal/stalker/data-access';
import {
    STALKER_PLAYLIST_CONNECTION_EDITOR_STATUS,
    type StalkerPlaylistConnectionEditor,
    type StalkerPlaylistConnectionResult,
} from '@iptvnator/playlist/shared/ui';
import {
    normalizeStalkerPortalIdentity,
    type Playlist,
    type PlaylistMeta,
    type PlaylistMetaUpdate,
} from '@iptvnator/shared/interfaces';

const STALKER_EDIT_ERROR_KEY_BY_KIND: Readonly<
    Record<StalkerPortalErrorKind, string>
> = {
    'login-required': 'HOME.STALKER_PORTAL.LOGIN_REQUIRED',
    'login-rejected': 'HOME.STALKER_PORTAL.LOGIN_REJECTED',
    'device-conflict': 'HOME.STALKER_PORTAL.DEVICE_CONFLICT',
    blocked: 'HOME.STALKER_PORTAL.PORTAL_REFUSED',
    'auth-failed': 'HOME.STALKER_PORTAL.AUTH_FAILED',
};

type StalkerEditFence = Awaited<
    ReturnType<StalkerSessionService['beginEditDiscovery']>
>;

@Injectable({ providedIn: 'root' })
export class AppStalkerPlaylistConnectionEditorService implements StalkerPlaylistConnectionEditor {
    private readonly discovery = inject(StalkerPortalDiscoveryService);
    private readonly portalRepair = inject(StalkerPortalRepairService);
    private readonly stalkerSession = inject(StalkerSessionService);
    private readonly stalkerStore = inject(StalkerStore);
    private readonly translate = inject(TranslateService);
    private readonly editFences = new Map<string, StalkerEditFence>();

    async applyResolvedConnection(playlist: PlaylistMetaUpdate): Promise<void> {
        // Edit discovery is newer and more authoritative than a lazy repair
        // remembered for the previous connection. Applying that override to
        // the resolved row could turn a credential-only A→A edit back into
        // the repair's old A→B result.
        const runtimePlaylist = this.toRuntimePlaylist(playlist);
        const fence =
            this.editFences.get(runtimePlaylist._id) ??
            (await this.beginEditFence(runtimePlaylist));
        try {
            const persistedPlaylist =
                await this.stalkerSession.replaceSessionAfterEdit(
                    runtimePlaylist,
                    fence
                );
            this.portalRepair.commitPlaylistEdit(runtimePlaylist._id);
            this.editFences.delete(runtimePlaylist._id);

            if (
                this.stalkerStore.currentPlaylist()?._id === runtimePlaylist._id
            ) {
                // The persistence result is the complete row merged by
                // PlaylistsService, so backup-restored playback headers and
                // other metadata absent from the form survive replacement.
                await this.stalkerStore.setCurrentPlaylist(persistedPlaylist);
            }
        } catch (error) {
            this.releaseEditFence(runtimePlaylist._id, fence);
            throw error;
        }
    }

    async resolveConnection(
        playlist: PlaylistMeta
    ): Promise<StalkerPlaylistConnectionResult> {
        const identity = normalizeStalkerPortalIdentity({
            serialNumber: playlist.stalkerSerialNumber,
            deviceId1: playlist.stalkerDeviceId1,
            deviceId2: playlist.stalkerDeviceId2,
            signature1: playlist.stalkerSignature1,
            signature2: playlist.stalkerSignature2,
        });
        const normalizedPlaylist: PlaylistMetaUpdate = {
            ...playlist,
            stalkerSerialNumber: identity.serialNumber ?? '',
            stalkerDeviceId1: identity.deviceId1 ?? '',
            stalkerDeviceId2: identity.deviceId2 ?? '',
            stalkerSignature1: identity.signature1 ?? '',
            stalkerSignature2: identity.signature2 ?? '',
        };
        const fence = await this.beginEditFence(
            this.toRuntimePlaylist(normalizedPlaylist)
        );
        let outcome: Awaited<
            ReturnType<StalkerPortalDiscoveryService['discover']>
        >;
        try {
            outcome = await this.discovery.discover(
                playlist.portalUrl ?? '',
                playlist.macAddress ?? '',
                identity,
                {
                    credentials: {
                        username: playlist.username ?? '',
                        password: playlist.password ?? '',
                    },
                }
            );
        } catch (error) {
            this.releaseEditFence(playlist._id, fence);
            throw error;
        }

        if (outcome.status === 'unreachable') {
            this.releaseEditFence(playlist._id, fence);
            return {
                status: STALKER_PLAYLIST_CONNECTION_EDITOR_STATUS.UNREACHABLE,
                message: this.translate.instant(
                    'HOME.STALKER_PORTAL.EDIT_UNREACHABLE'
                ),
            };
        }

        if (outcome.status === 'auth-rejected') {
            this.releaseEditFence(playlist._id, fence);
            return {
                status: STALKER_PLAYLIST_CONNECTION_EDITOR_STATUS.AUTH_REJECTED,
                message: this.buildAuthErrorMessage(outcome.error),
            };
        }

        const resolvedPlaylist: PlaylistMetaUpdate = {
            ...normalizedPlaylist,
            portalUrl: outcome.portalUrl,
            isFullStalkerPortal: outcome.isFullStalkerPortal,
        };

        if (!outcome.isFullStalkerPortal) {
            return {
                status: STALKER_PLAYLIST_CONNECTION_EDITOR_STATUS.RESOLVED,
                playlist: {
                    ...resolvedPlaylist,
                    stalkerSessionPatch: null,
                },
            };
        }

        if (!outcome.token) {
            this.releaseEditFence(playlist._id, fence);
            return {
                status: STALKER_PLAYLIST_CONNECTION_EDITOR_STATUS.AUTH_REJECTED,
                message: this.translate.instant(
                    'HOME.STALKER_PORTAL.AUTH_FAILED'
                ),
            };
        }

        return {
            status: STALKER_PLAYLIST_CONNECTION_EDITOR_STATUS.RESOLVED,
            playlist: {
                ...resolvedPlaylist,
                stalkerSessionPatch: {
                    stalkerToken: outcome.token,
                    stalkerSessionIdentity:
                        stalkerSessionFingerprint(resolvedPlaylist),
                    stalkerWatchdogTimeout:
                        outcome.watchdogTimeoutSeconds ??
                        STALKER_WATCHDOG_DEFAULT_PERIOD_SECONDS,
                    stalkerTimeslot: outcome.timeslotSeconds ?? 0,
                    stalkerAccountInfo: outcome.accountInfo
                        ? {
                              login: outcome.accountInfo.login,
                              expireDate: outcome.accountInfo.expire_date,
                              tariffPlanName:
                                  outcome.accountInfo.tariff_plan_name,
                              status: outcome.accountInfo.status,
                          }
                        : undefined,
                },
            },
        };
    }

    private async beginEditFence(
        playlist: Playlist
    ): Promise<StalkerEditFence> {
        // Both fences are installed synchronously before either drain is
        // awaited. No new authentication or lazy repair can start while the
        // work that predates this Edit is settling.
        const repairDrain = this.portalRepair.fenceForPlaylistEdit(
            playlist._id
        );
        let fence: StalkerEditFence | undefined;
        try {
            fence = await this.stalkerSession.beginEditDiscovery(playlist);
            await repairDrain;
            this.editFences.set(playlist._id, fence);
            return fence;
        } catch (error) {
            if (fence) {
                this.stalkerSession.cancelEditDiscovery(fence);
            }
            this.portalRepair.releasePlaylistEdit(playlist._id);
            throw error;
        }
    }

    private releaseEditFence(
        playlistId: string,
        fence: StalkerEditFence
    ): void {
        if (this.editFences.get(playlistId) === fence) {
            this.editFences.delete(playlistId);
        }
        this.stalkerSession.cancelEditDiscovery(fence);
        this.portalRepair.releasePlaylistEdit(playlistId);
    }

    private buildAuthErrorMessage(error: unknown): string {
        const portalError = asStalkerPortalError(error);
        const headline = this.translate.instant(
            portalError
                ? STALKER_EDIT_ERROR_KEY_BY_KIND[portalError.kind]
                : 'HOME.STALKER_PORTAL.AUTH_FAILED'
        );

        if (!portalError?.portalText) {
            return headline;
        }

        return `${headline} ${this.translate.instant(
            'HOME.STALKER_PORTAL.PORTAL_MESSAGE',
            { message: portalError.portalText }
        )}`;
    }

    private toRuntimePlaylist(update: PlaylistMetaUpdate): Playlist {
        const { stalkerSessionPatch, ...metadata } = update;
        return {
            lastUsage: '',
            ...metadata,
            ...(stalkerSessionPatch !== undefined
                ? {
                      stalkerToken: stalkerSessionPatch?.stalkerToken,
                      stalkerSessionIdentity:
                          stalkerSessionPatch?.stalkerSessionIdentity,
                      stalkerWatchdogTimeout:
                          stalkerSessionPatch?.stalkerWatchdogTimeout,
                      stalkerTimeslot: stalkerSessionPatch?.stalkerTimeslot,
                      stalkerAccountInfo:
                          stalkerSessionPatch?.stalkerAccountInfo,
                  }
                : {}),
        } as Playlist;
    }
}
