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

@Injectable({ providedIn: 'root' })
export class AppStalkerPlaylistConnectionEditorService implements StalkerPlaylistConnectionEditor {
    private readonly discovery = inject(StalkerPortalDiscoveryService);
    private readonly portalRepair = inject(StalkerPortalRepairService);
    private readonly stalkerSession = inject(StalkerSessionService);
    private readonly stalkerStore = inject(StalkerStore);
    private readonly translate = inject(TranslateService);

    async applyResolvedConnection(playlist: PlaylistMetaUpdate): Promise<void> {
        // Edit discovery is newer and more authoritative than a lazy repair
        // remembered for the previous connection. Applying that override to
        // the resolved row could turn a credential-only A→A edit back into
        // the repair's old A→B result.
        const runtimePlaylist = this.toRuntimePlaylist(playlist);
        this.portalRepair.retireForPlaylistEdit(runtimePlaylist._id);
        const sessionReplacement =
            this.stalkerSession.replaceSessionAfterEdit(runtimePlaylist);

        let activePlaylistUpdate = Promise.resolve();
        if (this.stalkerStore.currentPlaylist()?._id === runtimePlaylist._id) {
            // `setCurrentPlaylist` patches the signal-store snapshot before
            // its optional SQLite sync awaits, and re-points/stops the active
            // watchdog synchronously. The next catalog/playback request can
            // therefore no longer use the pre-edit endpoint or identity.
            activePlaylistUpdate =
                this.stalkerStore.setCurrentPlaylist(runtimePlaylist);
        }
        await Promise.all([sessionReplacement, activePlaylistUpdate]);
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
        const outcome = await this.discovery.discover(
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

        if (outcome.status === 'unreachable') {
            return {
                status: STALKER_PLAYLIST_CONNECTION_EDITOR_STATUS.UNREACHABLE,
                message: this.translate.instant(
                    'HOME.STALKER_PORTAL.EDIT_UNREACHABLE'
                ),
            };
        }

        if (outcome.status === 'auth-rejected') {
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
