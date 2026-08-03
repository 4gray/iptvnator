import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import {
    stalkerSessionFingerprint,
    StalkerPortalDiscoveryService,
    StalkerPortalError,
} from '@iptvnator/portal/stalker/data-access';
import { Playlist } from '@iptvnator/shared/interfaces';
import { StalkerPortalImportComponent } from './stalker-portal-import.component';

describe('StalkerPortalImportComponent identity handling', () => {
    let component: StalkerPortalImportComponent;
    let portalDiscovery: { discover: jest.Mock };
    let store: { dispatch: jest.Mock };
    let snackBar: { open: jest.Mock };

    beforeEach(() => {
        portalDiscovery = {
            discover: jest.fn().mockResolvedValue({
                status: 'resolved',
                portalUrl:
                    'https://portal.example.com/stalker_portal/server/load.php',
                isFullStalkerPortal: true,
                token: 'token-1',
            }),
        };
        store = {
            dispatch: jest.fn(),
        };
        snackBar = { open: jest.fn() };

        TestBed.configureTestingModule({
            providers: [
                {
                    provide: StalkerPortalDiscoveryService,
                    useValue: portalDiscovery,
                },
                { provide: Store, useValue: store },
                {
                    provide: MatSnackBar,
                    useValue: snackBar,
                },
                {
                    provide: TranslateService,
                    useValue: { instant: jest.fn((value: string) => value) },
                },
            ],
        });

        component = TestBed.runInInjectionContext(
            () => new StalkerPortalImportComponent()
        );
    });

    it('passes trimmed SN, device IDs, and signatures into initial authentication and persisted playlist metadata', async () => {
        component.form.patchValue({
            _id: 'playlist-1',
            title: 'Strict Portal',
            macAddress: '00:1A:79:AA:BB:CC',
            portalUrl: 'https://portal.example.com/stalker_portal/c',
            serialNumber: '  CUSTOMSN123  ',
            deviceId1: '  DEVICE-ID-1  ',
            deviceId2: '  DEVICE-ID-2  ',
            signature1: '  SIGNATURE-1  ',
            signature2: '  SIGNATURE-2  ',
            importDate: '2026-05-15T00:00:00.000Z',
        });

        await component.addPlaylist();

        expect(portalDiscovery.discover).toHaveBeenCalledWith(
            'https://portal.example.com/stalker_portal/c',
            '00:1A:79:AA:BB:CC',
            {
                serialNumber: 'CUSTOMSN123',
                deviceId1: 'DEVICE-ID-1',
                deviceId2: 'DEVICE-ID-2',
                signature1: 'SIGNATURE-1',
                signature2: 'SIGNATURE-2',
            },
            // Credentials ride along for portals that answer get_profile
            // with status 2 (login/password required).
            { credentials: { username: '', password: '' } }
        );

        const playlist = store.dispatch.mock.calls[0][0].playlist;
        expect(playlist).toEqual(
            expect.objectContaining({
                portalUrl:
                    'https://portal.example.com/stalker_portal/server/load.php',
                isFullStalkerPortal: true,
                stalkerToken: 'token-1',
                stalkerSerialNumber: 'CUSTOMSN123',
                stalkerDeviceId1: 'DEVICE-ID-1',
                stalkerDeviceId2: 'DEVICE-ID-2',
                stalkerSignature1: 'SIGNATURE-1',
                stalkerSignature2: 'SIGNATURE-2',
            })
        );
        expect(playlist.serialNumber).toBeUndefined();
        expect(playlist.deviceId1).toBeUndefined();
        expect(playlist.deviceId2).toBeUndefined();
        expect(playlist.signature1).toBeUndefined();
        expect(playlist.signature2).toBeUndefined();
    });

    it('keeps blank Stalker identity fields absent instead of generating defaults', async () => {
        component.form.patchValue({
            _id: 'playlist-1',
            title: 'MAC Only Portal',
            macAddress: '00:1A:79:AA:BB:CC',
            portalUrl: 'https://portal.example.com/stalker_portal/c',
            serialNumber: '  ',
            deviceId1: '  ',
            deviceId2: '',
            signature1: '  ',
            signature2: '',
            importDate: '2026-05-15T00:00:00.000Z',
        });

        await component.addPlaylist();

        expect(portalDiscovery.discover).toHaveBeenCalledWith(
            'https://portal.example.com/stalker_portal/c',
            '00:1A:79:AA:BB:CC',
            {},
            { credentials: { username: '', password: '' } }
        );

        const playlist = store.dispatch.mock.calls[0][0].playlist;
        expect(playlist.stalkerSerialNumber).toBeUndefined();
        expect(playlist.stalkerDeviceId1).toBeUndefined();
        expect(playlist.stalkerDeviceId2).toBeUndefined();
        expect(playlist.stalkerSignature1).toBeUndefined();
        expect(playlist.stalkerSignature2).toBeUndefined();
        expect(playlist.serialNumber).toBeUndefined();
        expect(playlist.deviceId1).toBeUndefined();
        expect(playlist.deviceId2).toBeUndefined();
        expect(playlist.signature1).toBeUndefined();
        expect(playlist.signature2).toBeUndefined();
    });

    it('passes the entered login and password into discovery', async () => {
        component.form.patchValue({
            _id: 'playlist-login',
            title: 'Login Portal',
            macAddress: '00:1A:79:00:00:08',
            portalUrl: 'https://portal.example.com/stalker_portal/c',
            username: 'user',
            password: 'secret',
            importDate: '2026-05-15T00:00:00.000Z',
        });

        await component.addPlaylist();

        expect(portalDiscovery.discover).toHaveBeenCalledWith(
            expect.any(String),
            '00:1A:79:00:00:08',
            {},
            { credentials: { username: 'user', password: 'secret' } }
        );
        // Persisted so runtime re-auth can repeat do_auth after the portal
        // drops the session.
        const playlist = store.dispatch.mock.calls[0][0].playlist;
        expect(playlist.username).toBe('user');
        expect(playlist.password).toBe('secret');
    });

    it('persists the cadence and the identity the token was negotiated for', async () => {
        portalDiscovery.discover.mockResolvedValue({
            status: 'resolved',
            portalUrl: 'https://portal.example.com/stalker_portal/server/load.php',
            isFullStalkerPortal: true,
            token: 'token-1',
            watchdogTimeoutSeconds: 90,
            timeslotSeconds: 11,
        });
        component.form.patchValue({
            _id: 'playlist-cadence',
            title: 'Cadence Portal',
            macAddress: '00:1A:79:AA:BB:CC',
            portalUrl: 'https://portal.example.com/stalker_portal/c',
            importDate: '2026-05-15T00:00:00.000Z',
        });

        await component.addPlaylist();

        const playlist = store.dispatch.mock.calls[0][0].playlist;
        expect(playlist.stalkerWatchdogTimeout).toBe(90);
        expect(playlist.stalkerTimeslot).toBe(11);
        // Without this a later start would re-present the token under an
        // edited identity.
        expect(playlist.stalkerSessionIdentity).toEqual(expect.any(String));
    });

    it('records credentials in the imported session fingerprint', async () => {
        // Otherwise the first runtime ensureToken() computes a fingerprint
        // WITH the credentials, mismatches the imported one, and discards the
        // session the import just established — silently defeating reuse for
        // exactly the login portals this flow exists for.
        portalDiscovery.discover.mockResolvedValue({
            status: 'resolved',
            portalUrl: 'https://portal.example.com/stalker_portal/server/load.php',
            isFullStalkerPortal: true,
            token: 'token-1',
        });
        component.form.patchValue({
            _id: 'playlist-login-fp',
            title: 'Login Portal',
            macAddress: '00:1A:79:00:00:08',
            portalUrl: 'https://portal.example.com/stalker_portal/c',
            username: 'user',
            password: 'secret',
            importDate: '2026-05-15T00:00:00.000Z',
        });

        await component.addPlaylist();

        const playlist = store.dispatch.mock.calls[0][0].playlist;
        expect(playlist.stalkerSessionIdentity).toBe(
            stalkerSessionFingerprint({
                portalUrl:
                    'https://portal.example.com/stalker_portal/server/load.php',
                macAddress: '00:1A:79:00:00:08',
                username: 'user',
                password: 'secret',
            } as Playlist)
        );
    });

    it('records the effective cadence when the portal advertises none', async () => {
        portalDiscovery.discover.mockResolvedValue({
            status: 'resolved',
            portalUrl: 'https://portal.example.com/stalker_portal/server/load.php',
            isFullStalkerPortal: true,
            token: 'token-1',
        });
        component.form.patchValue({
            _id: 'playlist-default-cadence',
            title: 'Quiet Portal',
            macAddress: '00:1A:79:AA:BB:CC',
            portalUrl: 'https://portal.example.com/stalker_portal/c',
            importDate: '2026-05-15T00:00:00.000Z',
        });

        await component.addPlaylist();

        const playlist = store.dispatch.mock.calls[0][0].playlist;
        // Stored absence has to keep meaning "never profiled", or every
        // later start would re-profile such a portal.
        expect(playlist.stalkerWatchdogTimeout).toBe(120);
        expect(playlist.stalkerTimeslot).toBe(0);
    });

    it("relays the portal's own refusal instead of a generic error", async () => {
        portalDiscovery.discover.mockResolvedValue({
            status: 'auth-rejected',
            portalUrl: 'https://portal.example.com/stalker_portal/server/load.php',
            error: new StalkerPortalError('login-required'),
        });
        component.form.patchValue({
            _id: 'playlist-refused',
            title: 'Login Portal',
            macAddress: '00:1A:79:00:00:08',
            portalUrl: 'https://portal.example.com/stalker_portal/c',
            importDate: '2026-05-15T00:00:00.000Z',
        });

        await component.addPlaylist();

        expect(snackBar.open).toHaveBeenCalledWith(
            'HOME.STALKER_PORTAL.LOGIN_REQUIRED',
            undefined,
            expect.any(Object)
        );
        expect(store.dispatch).not.toHaveBeenCalled();
    });

    it("appends the portal's explanation to a blocked refusal", async () => {
        portalDiscovery.discover.mockResolvedValue({
            status: 'auth-rejected',
            portalUrl: 'https://portal.example.com/stalker_portal/server/load.php',
            error: new StalkerPortalError(
                'blocked',
                'device conflict - device_id mismatch'
            ),
        });
        component.form.patchValue({
            _id: 'playlist-blocked',
            title: 'Blocked Portal',
            macAddress: '00:1A:79:AA:BB:CC',
            portalUrl: 'https://portal.example.com/stalker_portal/c',
            importDate: '2026-05-15T00:00:00.000Z',
        });

        await component.addPlaylist();

        // The translate mock returns keys, so both the kind headline and the
        // portal-message wrapper must be present.
        expect(snackBar.open).toHaveBeenCalledWith(
            'HOME.STALKER_PORTAL.PORTAL_REFUSED HOME.STALKER_PORTAL.PORTAL_MESSAGE',
            undefined,
            expect.any(Object)
        );
    });

    it('classifies the offline fallback on the normalized URL, not the raw query', async () => {
        // A query merely MENTIONING /server/load.php must not make a
        // panel-style /c URL look canonical and abort the offline import.
        portalDiscovery.discover.mockResolvedValue({ status: 'unreachable' });
        component.form.patchValue({
            _id: 'playlist-3',
            title: 'Query Panel',
            macAddress: '00:1A:79:AA:BB:CC',
            portalUrl: 'https://panel.example.com/c?redirect=/server/load.php',
            importDate: '2026-05-15T00:00:00.000Z',
        });

        await component.addPlaylist();

        const playlist = store.dispatch.mock.calls[0][0].playlist;
        expect(playlist).toEqual(
            expect.objectContaining({
                portalUrl: 'https://panel.example.com/portal.php',
                isFullStalkerPortal: false,
            })
        );
    });

    it('normalizes a query-carrying /c URL in the unreachable-host fallback', async () => {
        // Offline panel: discovery finds nothing, the legacy guess imports
        // anyway — but the suffix rewrite must run on the PATH, or
        // `/c?key=value` would persist the browser page instead of
        // portal.php (and a 200 HTML answer is not a repair trigger later).
        portalDiscovery.discover.mockResolvedValue({ status: 'unreachable' });
        component.form.patchValue({
            _id: 'playlist-2',
            title: 'Offline Panel',
            macAddress: '00:1A:79:AA:BB:CC',
            portalUrl: 'https://panel.example.com/c?key=value',
            importDate: '2026-05-15T00:00:00.000Z',
        });

        await component.addPlaylist();

        const playlist = store.dispatch.mock.calls[0][0].playlist;
        expect(playlist).toEqual(
            expect.objectContaining({
                portalUrl: 'https://panel.example.com/portal.php',
                isFullStalkerPortal: false,
            })
        );
    });
});
