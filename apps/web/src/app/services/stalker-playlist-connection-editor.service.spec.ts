import { TestBed } from '@angular/core/testing';
import { TranslateService } from '@ngx-translate/core';
import {
    StalkerPortalDiscoveryService,
    StalkerPortalError,
    StalkerPortalRepairService,
    StalkerSessionService,
    StalkerStore,
    stalkerSessionFingerprint,
} from '@iptvnator/portal/stalker/data-access';
import { STALKER_PLAYLIST_CONNECTION_EDITOR_STATUS } from '@iptvnator/playlist/shared/ui';
import type { PlaylistMeta } from '@iptvnator/shared/interfaces';
import { AppStalkerPlaylistConnectionEditorService } from './stalker-playlist-connection-editor.service';

describe('AppStalkerPlaylistConnectionEditorService', () => {
    const discovery = {
        discover: jest.fn(),
    };
    const portalRepair = {
        applyOverride: jest.fn((playlist: PlaylistMeta) => playlist),
        retireForPlaylistEdit: jest.fn(),
    };
    const stalkerSession = {
        replaceSessionAfterEdit: jest.fn().mockResolvedValue(undefined),
    };
    let activePlaylist: PlaylistMeta | undefined;
    const stalkerStore = {
        currentPlaylist: jest.fn(() => activePlaylist),
        setCurrentPlaylist: jest.fn((playlist: PlaylistMeta) => {
            activePlaylist = playlist;
        }),
    };
    const translate = {
        instant: jest.fn((key: string) => key),
    };

    const draft: PlaylistMeta = {
        _id: 'stalker-1',
        title: 'Stalker Portal',
        count: 0,
        importDate: '2026-08-08T00:00:00.000Z',
        portalUrl: 'https://portal.example.com/c',
        macAddress: '00:1A:79:AA:BB:CC',
        username: 'subscriber',
        password: 'secret',
        stalkerSerialNumber: ' SERIAL ',
        stalkerDeviceId1: ' DEVICE-1 ',
        stalkerDeviceId2: '',
        stalkerSignature1: ' SIGNATURE-1 ',
        stalkerSignature2: '',
    };

    let service: AppStalkerPlaylistConnectionEditorService;

    beforeEach(() => {
        jest.clearAllMocks();
        activePlaylist = undefined;
        TestBed.configureTestingModule({
            providers: [
                AppStalkerPlaylistConnectionEditorService,
                {
                    provide: StalkerPortalDiscoveryService,
                    useValue: discovery,
                },
                {
                    provide: StalkerPortalRepairService,
                    useValue: portalRepair,
                },
                {
                    provide: StalkerSessionService,
                    useValue: stalkerSession,
                },
                { provide: StalkerStore, useValue: stalkerStore },
                { provide: TranslateService, useValue: translate },
            ],
        });
        service = TestBed.inject(AppStalkerPlaylistConnectionEditorService);
    });

    it('resolves a simple portal and clears the previous full session', async () => {
        discovery.discover.mockResolvedValue({
            status: 'resolved',
            portalUrl: 'https://portal.example.com/portal.php',
            isFullStalkerPortal: false,
        });

        const result = await service.resolveConnection(draft);

        expect(discovery.discover).toHaveBeenCalledWith(
            draft.portalUrl,
            draft.macAddress,
            {
                serialNumber: 'SERIAL',
                deviceId1: 'DEVICE-1',
                signature1: 'SIGNATURE-1',
            },
            {
                credentials: {
                    username: 'subscriber',
                    password: 'secret',
                },
            }
        );
        expect(result).toEqual({
            status: STALKER_PLAYLIST_CONNECTION_EDITOR_STATUS.RESOLVED,
            playlist: {
                ...draft,
                portalUrl: 'https://portal.example.com/portal.php',
                isFullStalkerPortal: false,
                stalkerSerialNumber: 'SERIAL',
                stalkerDeviceId1: 'DEVICE-1',
                stalkerDeviceId2: '',
                stalkerSignature1: 'SIGNATURE-1',
                stalkerSignature2: '',
                stalkerSessionPatch: null,
            },
        });
    });

    it('replaces a full-portal session with the confirmed authorization result', async () => {
        discovery.discover.mockResolvedValue({
            status: 'resolved',
            portalUrl: 'https://portal.example.com/server/load.php',
            isFullStalkerPortal: true,
            token: 'NEW_TOKEN',
            watchdogTimeoutSeconds: 75,
            timeslotSeconds: 8,
            accountInfo: {
                login: 'subscriber',
                expire_date: 1800000000,
                tariff_plan_name: 'Premium',
                status: 0,
            },
        });

        const result = await service.resolveConnection(draft);
        const resolvedPlaylist = {
            ...draft,
            portalUrl: 'https://portal.example.com/server/load.php',
            isFullStalkerPortal: true,
            stalkerSerialNumber: 'SERIAL',
            stalkerDeviceId1: 'DEVICE-1',
            stalkerDeviceId2: '',
            stalkerSignature1: 'SIGNATURE-1',
            stalkerSignature2: '',
        };

        expect(result).toEqual({
            status: STALKER_PLAYLIST_CONNECTION_EDITOR_STATUS.RESOLVED,
            playlist: {
                ...resolvedPlaylist,
                stalkerSessionPatch: {
                    stalkerToken: 'NEW_TOKEN',
                    stalkerSessionIdentity:
                        stalkerSessionFingerprint(resolvedPlaylist),
                    stalkerWatchdogTimeout: 75,
                    stalkerTimeslot: 8,
                    stalkerAccountInfo: {
                        login: 'subscriber',
                        expireDate: 1800000000,
                        tariffPlanName: 'Premium',
                        status: 0,
                    },
                },
            },
        });
    });

    it('returns a user-facing portal refusal without producing an update', async () => {
        discovery.discover.mockResolvedValue({
            status: 'auth-rejected',
            portalUrl: 'https://portal.example.com/server/load.php',
            error: new StalkerPortalError(
                'login-rejected',
                'Subscription expired'
            ),
        });

        await expect(service.resolveConnection(draft)).resolves.toEqual({
            status: STALKER_PLAYLIST_CONNECTION_EDITOR_STATUS.AUTH_REJECTED,
            message:
                'HOME.STALKER_PORTAL.LOGIN_REJECTED HOME.STALKER_PORTAL.PORTAL_MESSAGE',
        });
    });

    it('returns a dedicated error when no endpoint can be reached', async () => {
        discovery.discover.mockResolvedValue({ status: 'unreachable' });

        await expect(service.resolveConnection(draft)).resolves.toEqual({
            status: STALKER_PLAYLIST_CONNECTION_EDITOR_STATUS.UNREACHABLE,
            message: 'HOME.STALKER_PORTAL.EDIT_UNREACHABLE',
        });
    });

    it('replaces the active runtime playlist and session after a resolved full-portal edit', async () => {
        activePlaylist = {
            ...draft,
            portalUrl: 'https://old.example.com/portal.php',
            isFullStalkerPortal: false,
        };
        const resolvedPlaylist = {
            ...draft,
            portalUrl: 'https://new.example.com/server/load.php',
            isFullStalkerPortal: true,
            stalkerSessionPatch: {
                stalkerToken: 'NEW_TOKEN',
                stalkerSessionIdentity: 'new-fingerprint',
                stalkerWatchdogTimeout: 90,
                stalkerTimeslot: 5,
            },
        };

        await service.applyResolvedConnection(resolvedPlaylist);

        expect(portalRepair.retireForPlaylistEdit).toHaveBeenCalledWith(
            draft._id
        );
        expect(stalkerSession.replaceSessionAfterEdit).toHaveBeenCalledWith(
            expect.objectContaining({
                portalUrl: 'https://new.example.com/server/load.php',
                isFullStalkerPortal: true,
                stalkerToken: 'NEW_TOKEN',
                stalkerSessionIdentity: 'new-fingerprint',
                stalkerWatchdogTimeout: 90,
                stalkerTimeslot: 5,
            })
        );
        expect(stalkerStore.setCurrentPlaylist).toHaveBeenCalledWith(
            expect.objectContaining({
                portalUrl: 'https://new.example.com/server/load.php',
                isFullStalkerPortal: true,
            })
        );
        expect(activePlaylist?.portalUrl).toBe(
            'https://new.example.com/server/load.php'
        );
    });

    it('clears the session and stops full-portal runtime behavior after a resolved simple edit', async () => {
        activePlaylist = {
            ...draft,
            portalUrl: 'https://old.example.com/server/load.php',
            isFullStalkerPortal: true,
        };
        const resolvedPlaylist = {
            ...draft,
            portalUrl: 'https://new.example.com/portal.php',
            isFullStalkerPortal: false,
            stalkerSessionPatch: null,
        };

        await service.applyResolvedConnection(resolvedPlaylist);

        expect(portalRepair.retireForPlaylistEdit).toHaveBeenCalledWith(
            draft._id
        );
        expect(stalkerSession.replaceSessionAfterEdit).toHaveBeenCalledWith(
            expect.objectContaining({
                portalUrl: 'https://new.example.com/portal.php',
                isFullStalkerPortal: false,
                stalkerToken: undefined,
                stalkerSessionIdentity: undefined,
            })
        );
        expect(activePlaylist).toEqual(
            expect.objectContaining({
                portalUrl: 'https://new.example.com/portal.php',
                isFullStalkerPortal: false,
                stalkerToken: undefined,
                stalkerSessionIdentity: undefined,
            })
        );
    });

    it('repoints the active snapshot before an old authentication finishes draining', async () => {
        activePlaylist = {
            ...draft,
            portalUrl: 'https://old.example.com/server/load.php',
            isFullStalkerPortal: true,
        };
        let finishReplacement: () => void = () => undefined;
        stalkerSession.replaceSessionAfterEdit.mockReturnValueOnce(
            new Promise<void>((resolve) => {
                finishReplacement = resolve;
            })
        );
        const resolvedPlaylist = {
            ...draft,
            portalUrl: 'https://new.example.com/portal.php',
            isFullStalkerPortal: false,
            stalkerSessionPatch: null,
        };

        const applying = service.applyResolvedConnection(resolvedPlaylist);

        expect(activePlaylist?.portalUrl).toBe(
            'https://new.example.com/portal.php'
        );
        let settled = false;
        void applying.then(() => (settled = true));
        await Promise.resolve();
        expect(settled).toBe(false);

        finishReplacement();
        await applying;
    });

    it.each([true, false])(
        'keeps the exact credential-only Edit result when a prior endpoint repair exists (active=%s)',
        async (isActive) => {
            const resolvedPlaylist = {
                ...draft,
                portalUrl: 'https://portal.example.com/server/load.php',
                isFullStalkerPortal: true,
                username: 'new-user',
                stalkerSessionPatch: {
                    stalkerToken: 'NEW_TOKEN',
                    stalkerSessionIdentity: 'new-fingerprint',
                    stalkerWatchdogTimeout: 90,
                    stalkerTimeslot: 5,
                },
            };
            // This is the remembered A→B repair that used to rewrite the
            // newly proven A endpoint when only credentials changed.
            portalRepair.applyOverride.mockReturnValue({
                ...resolvedPlaylist,
                portalUrl: 'https://portal.example.com/portal.php',
            });
            activePlaylist = isActive
                ? {
                      ...draft,
                      portalUrl: 'https://portal.example.com/portal.php',
                  }
                : undefined;

            await service.applyResolvedConnection(resolvedPlaylist);

            expect(portalRepair.applyOverride).not.toHaveBeenCalled();
            expect(portalRepair.retireForPlaylistEdit).toHaveBeenCalledWith(
                draft._id
            );
            expect(stalkerSession.replaceSessionAfterEdit).toHaveBeenCalledWith(
                expect.objectContaining({
                    portalUrl: 'https://portal.example.com/server/load.php',
                    username: 'new-user',
                    stalkerToken: 'NEW_TOKEN',
                })
            );
            expect(stalkerStore.setCurrentPlaylist).toHaveBeenCalledTimes(
                isActive ? 1 : 0
            );
            if (isActive) {
                expect(activePlaylist?.portalUrl).toBe(
                    'https://portal.example.com/server/load.php'
                );
            }
        }
    );
});
