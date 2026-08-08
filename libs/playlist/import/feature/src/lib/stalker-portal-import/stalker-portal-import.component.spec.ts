import { webcrypto } from 'node:crypto';
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

    // jsdom ships no WebCrypto. Install Node's real implementation rather
    // than a stub, so the derived device IDs asserted below are the values a
    // portal would actually be handed.
    const originalCrypto = globalThis.crypto;
    beforeAll(() => {
        Object.defineProperty(globalThis, 'crypto', {
            configurable: true,
            value: webcrypto,
        });
    });
    afterAll(() => {
        Object.defineProperty(globalThis, 'crypto', {
            configurable: true,
            value: originalCrypto,
        });
    });

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

    it('accepts HTTP(S) bare hosts and rejects URLs without a web protocol', () => {
        const control = component.form.controls.portalUrl;

        control.setValue('portal.example.com');
        expect(control.valid).toBe(false);

        control.setValue('file:///tmp/portal.php');
        expect(control.valid).toBe(false);

        control.setValue('https://portal.example.com');
        expect(control.valid).toBe(true);
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
            portalUrl:
                'https://portal.example.com/stalker_portal/server/load.php',
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
            portalUrl:
                'https://portal.example.com/stalker_portal/server/load.php',
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
            portalUrl:
                'https://portal.example.com/stalker_portal/server/load.php',
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
            portalUrl:
                'https://portal.example.com/stalker_portal/server/load.php',
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
            portalUrl:
                'https://portal.example.com/stalker_portal/server/load.php',
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

    describe('MAC address handling', () => {
        it('canonicalizes the typed MAC on blur', async () => {
            component.form.patchValue({ macAddress: '00-1a-79-ab-cd-ef' });

            await component.onMacAddressBlur();

            expect(component.form.controls.macAddress.value).toBe(
                '00:1A:79:AB:CD:EF'
            );
        });

        it('rejects a malformed MAC before anything reaches the portal', async () => {
            component.form.patchValue({
                _id: 'playlist-bad-mac',
                title: 'Typo Portal',
                macAddress: '00:1A:79:AA:BB',
                portalUrl: 'https://portal.example.com/c',
                importDate: '2026-05-15T00:00:00.000Z',
            });

            expect(component.form.controls.macAddress.valid).toBe(false);

            await component.addPlaylist();

            expect(portalDiscovery.discover).not.toHaveBeenCalled();
            expect(store.dispatch).not.toHaveBeenCalled();
        });

        it('canonicalizes a submitted MAC that was never blurred', async () => {
            // Keyboard users can reach Add without the field losing focus.
            component.form.patchValue({
                _id: 'playlist-unblurred',
                title: 'Panel',
                macAddress: '001a79aabbcc',
                portalUrl: 'https://portal.example.com/c',
                importDate: '2026-05-15T00:00:00.000Z',
            });

            await component.addPlaylist();

            expect(portalDiscovery.discover).toHaveBeenCalledWith(
                'https://portal.example.com/c',
                '00:1A:79:AA:BB:CC',
                expect.any(Object),
                expect.any(Object)
            );
            expect(store.dispatch.mock.calls[0][0].playlist.macAddress).toBe(
                '00:1A:79:AA:BB:CC'
            );
        });

        it('imports a MAC outside the Infomir range', async () => {
            // The stock portal's OUI filter is off on most reseller panels, so
            // a non-Infomir MAC is a working setup for a lot of users. The
            // hint explains what stock Ministra will do; it must not block.
            component.form.patchValue({
                _id: 'playlist-foreign-oui',
                title: 'Reseller Panel',
                macAddress: 'AA:BB:CC:DD:EE:01',
                portalUrl: 'https://panel.example.com/c',
                importDate: '2026-05-15T00:00:00.000Z',
            });

            expect(component.form.controls.macAddress.valid).toBe(true);
            expect(component.showsForeignOuiHint).toBe(true);

            await component.addPlaylist();

            expect(portalDiscovery.discover).toHaveBeenCalledWith(
                'https://panel.example.com/c',
                'AA:BB:CC:DD:EE:01',
                expect.any(Object),
                expect.any(Object)
            );
            expect(store.dispatch.mock.calls[0][0].playlist.macAddress).toBe(
                'AA:BB:CC:DD:EE:01'
            );
        });

        it('hints only when the MAC is valid but outside the Infomir range', () => {
            expect(component.showsForeignOuiHint).toBe(false);

            component.form.patchValue({ macAddress: '00:1A:79:AA:BB:CC' });
            expect(component.showsForeignOuiHint).toBe(false);

            component.form.patchValue({ macAddress: '00:1B:79:AA:BB:CC' });
            expect(component.showsForeignOuiHint).toBe(true);

            // A half-typed address is an error, not an OUI warning.
            component.form.patchValue({ macAddress: '00:1B' });
            expect(component.showsForeignOuiHint).toBe(false);
        });
    });

    describe('device ID derivation', () => {
        // Uppercase hex SHA-256 of the canonical MAC, and of that MAC plus
        // the `stalker` salt — the values StbEmu and stalker-to-m3u pin
        // server-side. Asserted literally: matching those clients byte for
        // byte is the entire point of the option.
        const DERIVED_FOR_AABBCC = {
            deviceId1:
                '21DA59C248805FDF0F36FA2C4CA4569E10D1F80268D8104C7AF8BB776D657ED8',
            deviceId2:
                'C6BA0906206A93A6CC4B6C2E94AC92EBC1A217784B692979DB373FABE0B3D2F5',
        };

        it('fills both device IDs with the StbEmu-compatible pair', async () => {
            component.form.patchValue({ macAddress: '00:1A:79:AA:BB:CC' });

            await component.toggleDeriveDeviceIds(true);

            expect(component.form.controls.deviceId1.value).toBe(
                DERIVED_FOR_AABBCC.deviceId1
            );
            // A real box reports the two from separate firmware calls and they
            // are never equal; the portal pins them permanently, so an
            // identical pair could not be corrected later.
            expect(component.form.controls.deviceId2.value).toBe(
                DERIVED_FOR_AABBCC.deviceId2
            );
            expect(component.form.controls.deviceId2.value).not.toBe(
                component.form.controls.deviceId1.value
            );
            // Derived values are shown, not hidden state — but they are not
            // hand-editable while derivation owns them.
            expect(component.form.controls.deviceId1.disabled).toBe(true);
            expect(component.form.controls.deviceId2.disabled).toBe(true);
        });

        it('persists the derived IDs as literal values', async () => {
            component.form.patchValue({
                _id: 'playlist-derived',
                title: 'Derived Portal',
                macAddress: '00:1A:79:AA:BB:CC',
                portalUrl: 'https://portal.example.com/c',
                importDate: '2026-05-15T00:00:00.000Z',
            });
            await component.toggleDeriveDeviceIds(true);

            await component.addPlaylist();

            // Disabled controls still have to reach the playlist, and they
            // have to arrive as strings — nothing may recompute them later,
            // when a MAC edit would turn them into a device conflict.
            const playlist = store.dispatch.mock.calls[0][0].playlist;
            expect(playlist.stalkerDeviceId1).toBe(
                DERIVED_FOR_AABBCC.deviceId1
            );
            expect(playlist.stalkerDeviceId2).toBe(
                DERIVED_FOR_AABBCC.deviceId2
            );
        });

        it('follows a corrected MAC while the box is still ticked', async () => {
            // Nothing is pinned until the import actually runs, so fixing a
            // typo has to fix the ID it would bind the account to.
            component.form.patchValue({ macAddress: '00:1A:79:AA:BB:CC' });
            await component.toggleDeriveDeviceIds(true);

            component.form.patchValue({ macAddress: '00:1A:79:AA:BB:CD' });
            await component.onMacAddressBlur();

            expect(component.form.controls.deviceId1.value).toBe(
                'A1474C4E43345F99C018F151C2D401A0231CFADC310E2514944641590F9C4504'
            );
            expect(component.form.controls.deviceId2.value).toBe(
                'EF401CECA8498585809B8D0FC20640A51148B72343D39DBC0A442AD26ED7A8DD'
            );
        });

        it("does not submit a MAC paired with the previous MAC's IDs", async () => {
            // Clicking Add blurs the MAC field, so the blur's SHA-256 is
            // still in flight when the click handler runs. Snapshotting the
            // form there pairs the corrected MAC with the old MAC's device
            // IDs — and the portal pins that pairing permanently.
            component.form.patchValue({
                _id: 'playlist-race',
                title: 'Race Portal',
                macAddress: '00:1A:79:AA:BB:CC',
                portalUrl: 'https://portal.example.com/c',
                importDate: '2026-05-15T00:00:00.000Z',
            });
            await component.toggleDeriveDeviceIds(true);

            component.form.patchValue({ macAddress: '00:1A:79:AA:BB:CD' });
            const blur = component.onMacAddressBlur();
            await component.addPlaylist();
            await blur;

            const playlist = store.dispatch.mock.calls[0][0].playlist;
            expect(playlist.macAddress).toBe('00:1A:79:AA:BB:CD');
            expect(playlist.stalkerDeviceId1).toBe(
                'A1474C4E43345F99C018F151C2D401A0231CFADC310E2514944641590F9C4504'
            );
            expect(playlist.stalkerDeviceId2).toBe(
                'EF401CECA8498585809B8D0FC20640A51148B72343D39DBC0A442AD26ED7A8DD'
            );
        });

        it('discards a derivation the next MAC edit superseded', async () => {
            component.form.patchValue({ macAddress: '00:1A:79:AA:BB:CC' });
            await component.toggleDeriveDeviceIds(true);

            // Two digests end up in flight at once, and nothing guarantees
            // they settle in the order they started. Node resolves them in
            // order for inputs this small, which would let this test pass
            // with no guard at all — so the older pair is explicitly held
            // back until the newer one has landed.
            const realDigest = webcrypto.subtle.digest.bind(webcrypto.subtle);
            let call = 0;
            const digest = jest
                .spyOn(globalThis.crypto.subtle, 'digest')
                .mockImplementation((async (
                    algorithm: AlgorithmIdentifier,
                    data: BufferSource
                ) => {
                    // One derivation is two digests, so the first invocation
                    // is calls 0 and 1.
                    const delayed = call++ < 2;
                    const result = await realDigest(algorithm, data);
                    if (delayed) {
                        await new Promise((resolve) => setTimeout(resolve, 20));
                    }
                    return result;
                }) as typeof globalThis.crypto.subtle.digest);

            try {
                const superseded = component.onMacAddressBlur();
                component.form.patchValue({ macAddress: '00:1A:79:AA:BB:CD' });
                const latest = component.onMacAddressBlur();
                await Promise.all([latest, superseded]);
            } finally {
                digest.mockRestore();
            }

            expect(component.form.controls.deviceId1.value).toBe(
                'A1474C4E43345F99C018F151C2D401A0231CFADC310E2514944641590F9C4504'
            );
            expect(component.form.controls.deviceId2.value).toBe(
                'EF401CECA8498585809B8D0FC20640A51148B72343D39DBC0A442AD26ED7A8DD'
            );
        });

        /**
         * Holds every digest until `release()` is called, so a toggle can be
         * observed landing WHILE one is in flight. Without this the digest
         * settles first and the assertions below hold either way.
         */
        function holdDigests(): {
            release: () => void;
            restore: () => void;
        } {
            const realDigest = webcrypto.subtle.digest.bind(webcrypto.subtle);
            let release = (): void => undefined;
            const gate = new Promise<void>((resolve) => {
                release = resolve;
            });
            const spy = jest
                .spyOn(globalThis.crypto.subtle, 'digest')
                .mockImplementation((async (
                    algorithm: AlgorithmIdentifier,
                    data: BufferSource
                ) => {
                    await gate;
                    return realDigest(algorithm, data);
                }) as typeof globalThis.crypto.subtle.digest);

            return { release, restore: () => spy.mockRestore() };
        }

        it('does not repopulate the fields when the box is unticked mid-digest', async () => {
            component.form.patchValue({ macAddress: '00:1A:79:AA:BB:CC' });
            const { release, restore } = holdDigests();

            try {
                const pending = component.toggleDeriveDeviceIds(true);
                await component.toggleDeriveDeviceIds(false);
                release();
                await pending;
            } finally {
                restore();
            }

            // The user opted out; a digest that was already running must not
            // put IDs back that the portal would then pin permanently.
            expect(component.derivesDeviceIds()).toBe(false);
            expect(component.form.controls.deviceId1.value).toBe('');
            expect(component.form.controls.deviceId2.value).toBe('');
        });

        it('does not repopulate the fields when the form is cleared mid-digest', async () => {
            component.form.patchValue({ macAddress: '00:1A:79:AA:BB:CC' });
            const { release, restore } = holdDigests();

            try {
                const pending = component.toggleDeriveDeviceIds(true);
                component.clearForm();
                release();
                await pending;
            } finally {
                restore();
            }

            expect(component.form.controls.deviceId1.value).toBe('');
            expect(component.form.controls.deviceId2.value).toBe('');
        });

        it('leaves the fields alone once the box is unticked', async () => {
            component.form.patchValue({ macAddress: '00:1A:79:AA:BB:CC' });
            await component.toggleDeriveDeviceIds(true);
            await component.toggleDeriveDeviceIds(false);

            expect(component.form.controls.deviceId1.value).toBe('');
            expect(component.form.controls.deviceId1.enabled).toBe(true);

            component.form.patchValue({ macAddress: '00:1A:79:AA:BB:CD' });
            await component.onMacAddressBlur();

            expect(component.form.controls.deviceId1.value).toBe('');
        });

        it('keeps the identity it authenticated with when unticked mid-import', async () => {
            // Discovery has already sent these IDs to the portal by the time a
            // slow answer comes back, so the portal has pinned them. Persisting
            // what the user unticked to instead — nothing — is the permanent
            // lockout, so the snapshot has to win. The toggle is locked while
            // the import runs precisely so the UI cannot imply otherwise.
            component.form.patchValue({
                _id: 'playlist-slow-discovery',
                title: 'Slow Portal',
                macAddress: '00:1A:79:AA:BB:CC',
                portalUrl: 'https://portal.example.com/c',
                importDate: '2026-05-15T00:00:00.000Z',
            });
            await component.toggleDeriveDeviceIds(true);

            let finishDiscovery = (): void => undefined;
            portalDiscovery.discover.mockImplementation(
                () =>
                    new Promise((resolve) => {
                        finishDiscovery = () =>
                            resolve({
                                status: 'resolved',
                                portalUrl: 'https://portal.example.com/c',
                                isFullStalkerPortal: false,
                            });
                    })
            );

            const importing = component.addPlaylist();
            // Submitting settles the derivation first, so several microtasks
            // pass before discovery is reached; poll rather than guess.
            for (
                let i = 0;
                i < 100 && portalDiscovery.discover.mock.calls.length === 0;
                i += 1
            ) {
                await new Promise((resolve) => setTimeout(resolve, 1));
            }

            expect(portalDiscovery.discover).toHaveBeenCalledTimes(1);
            expect(component.isLoading()).toBe(true);
            expect(component.hasManualDeviceIds).toBe(true);

            // Even if the toggle were reachable, the import must not change.
            await component.toggleDeriveDeviceIds(false);
            finishDiscovery();
            await importing;

            const playlist = store.dispatch.mock.calls[0][0].playlist;
            expect(playlist.stalkerDeviceId1).toBe(
                DERIVED_FOR_AABBCC.deviceId1
            );
            expect(playlist.stalkerDeviceId2).toBe(
                DERIVED_FOR_AABBCC.deviceId2
            );
        });

        it("never pairs one MAC with another MAC's device IDs", async () => {
            // The submit-time digest is asynchronous, so a MAC edit can land
            // while it runs. Reading the MAC from the form afterwards would
            // ship the new address with the old address's IDs — a mismatch
            // the portal pins permanently as a device conflict.
            component.form.patchValue({
                _id: 'playlist-desync',
                title: 'Desync Portal',
                macAddress: '00:1A:79:AA:BB:CC',
                portalUrl: 'https://portal.example.com/c',
                importDate: '2026-05-15T00:00:00.000Z',
            });
            await component.toggleDeriveDeviceIds(true);

            const { release, restore } = holdDigests();
            try {
                const importing = component.addPlaylist();
                await Promise.resolve();
                // Simulates the field changing mid-digest.
                component.form.controls.macAddress.setValue(
                    '00:1A:79:AA:BB:CD'
                );
                release();
                await importing;
            } finally {
                restore();
            }

            const playlist = store.dispatch.mock.calls[0][0].playlist;
            expect(playlist.macAddress).toBe('00:1A:79:AA:BB:CC');
            expect(playlist.stalkerDeviceId1).toBe(
                DERIVED_FOR_AABBCC.deviceId1
            );
            expect(playlist.stalkerDeviceId2).toBe(
                DERIVED_FOR_AABBCC.deviceId2
            );
            expect(portalDiscovery.discover).toHaveBeenCalledWith(
                expect.any(String),
                '00:1A:79:AA:BB:CC',
                expect.objectContaining({
                    deviceId1: DERIVED_FOR_AABBCC.deviceId1,
                }),
                expect.any(Object)
            );
        });

        it('freezes the identity fields while the import runs', async () => {
            component.form.patchValue({
                _id: 'playlist-frozen',
                title: 'Frozen Portal',
                macAddress: '00:1A:79:AA:BB:CC',
                portalUrl: 'https://portal.example.com/c',
                importDate: '2026-05-15T00:00:00.000Z',
            });

            await component.toggleDeriveDeviceIds(true);

            let finishDiscovery = (): void => undefined;
            portalDiscovery.discover.mockImplementation(
                () =>
                    new Promise((resolve) => {
                        finishDiscovery = () =>
                            resolve({
                                status: 'unreachable',
                            });
                    })
            );

            const importing = component.addPlaylist();
            for (
                let i = 0;
                i < 100 && portalDiscovery.discover.mock.calls.length === 0;
                i += 1
            ) {
                await new Promise((resolve) => setTimeout(resolve, 1));
            }

            expect(component.form.controls.macAddress.disabled).toBe(true);
            expect(component.form.controls.title.disabled).toBe(true);

            finishDiscovery();
            await importing;

            // Restored afterwards, with derivation keeping its own lock.
            expect(component.form.controls.macAddress.enabled).toBe(true);
            expect(component.form.controls.deviceId1.disabled).toBe(true);
        });

        it('refuses to overwrite a hand-entered device ID', () => {
            expect(component.hasManualDeviceIds).toBe(false);

            component.form.patchValue({ deviceId1: 'PROVIDER-SUPPLIED' });

            expect(component.hasManualDeviceIds).toBe(true);
        });

        it('derives nothing while the MAC is unusable', async () => {
            component.form.patchValue({ macAddress: 'not-a-mac' });

            await component.toggleDeriveDeviceIds(true);

            // Hashing a typo would pin the account to it permanently.
            expect(component.form.controls.deviceId1.value).toBe('');
            expect(component.form.controls.deviceId2.value).toBe('');
        });

        it('clears derivation state on form reset', async () => {
            component.form.patchValue({ macAddress: '00:1A:79:AA:BB:CC' });
            await component.toggleDeriveDeviceIds(true);

            component.clearForm();

            expect(component.derivesDeviceIds()).toBe(false);
            expect(component.form.controls.deviceId1.enabled).toBe(true);
            expect(component.form.controls.deviceId1.value).toBe('');
        });

        it('is deterministic across input formatting', async () => {
            component.form.patchValue({ macAddress: '00:1A:79:AA:BB:CC' });
            await component.toggleDeriveDeviceIds(true);
            const canonical = component.form.controls.deviceId1.value;

            component.form.patchValue({ macAddress: '00-1a-79-aa-bb-cc' });
            await component.onMacAddressBlur();

            expect(canonical).toBe(DERIVED_FOR_AABBCC.deviceId1);
            expect(component.form.controls.deviceId1.value).toBe(canonical);
        });
    });

    it('gives a device conflict its own headline', async () => {
        portalDiscovery.discover.mockResolvedValue({
            status: 'auth-rejected',
            portalUrl:
                'https://portal.example.com/stalker_portal/server/load.php',
            error: new StalkerPortalError(
                'device-conflict',
                'device conflict - device_id mismatch'
            ),
        });
        component.form.patchValue({
            _id: 'playlist-conflict',
            title: 'Conflicting Portal',
            macAddress: '00:1A:79:AA:BB:CC',
            portalUrl: 'https://portal.example.com/stalker_portal/c',
            importDate: '2026-05-15T00:00:00.000Z',
        });

        await component.addPlaylist();

        expect(snackBar.open).toHaveBeenCalledWith(
            'HOME.STALKER_PORTAL.DEVICE_CONFLICT HOME.STALKER_PORTAL.PORTAL_MESSAGE',
            undefined,
            expect.any(Object)
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

    it('persists portal.php instead of the root page for an unreachable bare host', async () => {
        portalDiscovery.discover.mockResolvedValue({ status: 'unreachable' });
        component.form.patchValue({
            _id: 'playlist-bare-host',
            title: 'Offline Panel',
            macAddress: '00:1A:79:AA:BB:CC',
            portalUrl: 'https://panel.example.com',
            importDate: '2026-05-15T00:00:00.000Z',
        });

        await component.addPlaylist();

        expect(store.dispatch.mock.calls[0][0].playlist).toEqual(
            expect.objectContaining({
                portalUrl: 'https://panel.example.com/portal.php',
                isFullStalkerPortal: false,
            })
        );
    });
});
