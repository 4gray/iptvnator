import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { StalkerSessionService } from '@iptvnator/portal/stalker/data-access';
import { StalkerPortalImportComponent } from './stalker-portal-import.component';

describe('StalkerPortalImportComponent identity handling', () => {
    let component: StalkerPortalImportComponent;
    let stalkerSession: { authenticate: jest.Mock };
    let store: { dispatch: jest.Mock };

    beforeEach(() => {
        stalkerSession = {
            authenticate: jest.fn().mockResolvedValue({ token: 'token-1' }),
        };
        store = {
            dispatch: jest.fn(),
        };

        TestBed.configureTestingModule({
            providers: [
                { provide: StalkerSessionService, useValue: stalkerSession },
                { provide: Store, useValue: store },
                {
                    provide: MatSnackBar,
                    useValue: { open: jest.fn() },
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

        expect(stalkerSession.authenticate).toHaveBeenCalledWith(
            'https://portal.example.com/stalker_portal/server/load.php',
            '00:1A:79:AA:BB:CC',
            {
                serialNumber: 'CUSTOMSN123',
                deviceId1: 'DEVICE-ID-1',
                deviceId2: 'DEVICE-ID-2',
                signature1: 'SIGNATURE-1',
                signature2: 'SIGNATURE-2',
            }
        );

        const playlist = store.dispatch.mock.calls[0][0].playlist;
        expect(playlist).toEqual(
            expect.objectContaining({
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

        expect(stalkerSession.authenticate).toHaveBeenCalledWith(
            'https://portal.example.com/stalker_portal/server/load.php',
            '00:1A:79:AA:BB:CC',
            {}
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
});
