import { TestBed } from '@angular/core/testing';
import { DataService } from '@iptvnator/services';
import { Playlist } from '@iptvnator/shared/interfaces';
import {
    STALKER_SERIAL_NUMBER,
    StalkerProfileResponse,
    StalkerSessionService,
} from './stalker-session.service';

type ExpectedStalkerPortalIdentity = {
    serialNumber?: string;
    deviceId1?: string;
    deviceId2?: string;
    signature1?: string;
    signature2?: string;
};

type GetProfileWithIdentity = (
    portalUrl: string,
    macAddress: string,
    token: string,
    identity: ExpectedStalkerPortalIdentity,
    handshakeRandom: string
) => Promise<StalkerProfileResponse>;

describe('StalkerSessionService identity payloads', () => {
    const portalUrl = 'https://portal.example.com/stalker_portal/server/load.php';
    const macAddress = '00:1A:79:AA:BB:CC';

    let service: StalkerSessionService;
    let dataService: { sendIpcEvent: jest.Mock };

    beforeEach(() => {
        Object.defineProperty(globalThis, 'crypto', {
            configurable: true,
            value: {
                subtle: {
                    digest: jest.fn(
                        async () => new Uint8Array(20).fill(1).buffer
                    ),
                },
            },
        });

        dataService = {
            sendIpcEvent: jest.fn().mockResolvedValue({ js: {} }),
        };

        TestBed.configureTestingModule({
            providers: [
                StalkerSessionService,
                { provide: DataService, useValue: dataService },
            ],
        });

        service = TestBed.inject(StalkerSessionService);
    });

    it('omits SN, device IDs, and signatures from get_profile when identity is blank', async () => {
        const getProfile =
            service.getProfile as unknown as GetProfileWithIdentity;

        await getProfile.call(
            service,
            portalUrl,
            macAddress,
            'token-1',
            {},
            'random-1'
        );

        const payload = lastStalkerPayload();
        expect(payload.serialNumber).toBeUndefined();
        expect(payload.params).not.toHaveProperty('sn');
        expect(payload.params).not.toHaveProperty('device_id');
        expect(payload.params).not.toHaveProperty('device_id2');
        expect(payload.params).not.toHaveProperty('signature');
        expect(payload.params).not.toHaveProperty('signature2');
        expect(JSON.parse(String(payload.params.metrics))).not.toHaveProperty(
            'sn'
        );
    });

    it('sends provided SN, device IDs, and signatures exactly in get_profile', async () => {
        const getProfile =
            service.getProfile as unknown as GetProfileWithIdentity;

        await getProfile.call(
            service,
            portalUrl,
            macAddress,
            'token-1',
            {
                serialNumber: 'CUSTOMSN123',
                deviceId1: 'DEVICE-ID-1',
                deviceId2: 'DEVICE-ID-2',
                signature1: 'SIGNATURE-1',
                signature2: 'SIGNATURE-2',
            },
            'random-1'
        );

        const payload = lastStalkerPayload();
        expect(payload.serialNumber).toBe('CUSTOMSN123');
        expect(payload.params).toEqual(
            expect.objectContaining({
                sn: 'CUSTOMSN123',
                device_id: 'DEVICE-ID-1',
                device_id2: 'DEVICE-ID-2',
                signature: 'SIGNATURE-1',
                signature2: 'SIGNATURE-2',
            })
        );
        expect(JSON.parse(String(payload.params.metrics))).toEqual(
            expect.objectContaining({
                sn: 'CUSTOMSN123',
            })
        );
    });

    it('passes stored playlist identity into ensureToken re-authentication', async () => {
        const authenticate = jest
            .spyOn(service, 'authenticate')
            .mockResolvedValue({ token: 'fresh-token' });

        await service.ensureToken({
            _id: 'playlist-1',
            portalUrl,
            macAddress,
            isFullStalkerPortal: true,
            stalkerSerialNumber: 'CUSTOMSN123',
            stalkerDeviceId1: 'DEVICE-ID-1',
            stalkerDeviceId2: 'DEVICE-ID-2',
            stalkerSignature1: 'SIGNATURE-1',
            stalkerSignature2: 'SIGNATURE-2',
        } as Playlist);

        expect(authenticate).toHaveBeenCalledWith(portalUrl, macAddress, {
            serialNumber: 'CUSTOMSN123',
            deviceId1: 'DEVICE-ID-1',
            deviceId2: 'DEVICE-ID-2',
            signature1: 'SIGNATURE-1',
            signature2: 'SIGNATURE-2',
        });
    });

    it('treats the legacy default serial number as absent during ensureToken', async () => {
        const authenticate = jest
            .spyOn(service, 'authenticate')
            .mockResolvedValue({ token: 'fresh-token' });

        const result = await service.ensureToken({
            _id: 'playlist-1',
            portalUrl,
            macAddress,
            isFullStalkerPortal: true,
            stalkerSerialNumber: STALKER_SERIAL_NUMBER,
        } as Playlist);

        expect(result.serialNumber).toBeUndefined();
        expect(authenticate).toHaveBeenCalledWith(portalUrl, macAddress, {});
    });

    it('passes an explicit serial into the initial handshake request', async () => {
        dataService.sendIpcEvent
            .mockResolvedValueOnce({
                js: {
                    token: 'token-1',
                    random: 'random-1',
                },
            })
            .mockResolvedValueOnce({ js: {} });

        await service.authenticate(portalUrl, macAddress, {
            serialNumber: 'CUSTOMSN123',
        });

        const handshakePayload = dataService.sendIpcEvent.mock.calls[0][1];
        expect(handshakePayload.params.action).toBe('handshake');
        expect(handshakePayload.serialNumber).toBe('CUSTOMSN123');
    });

    function lastStalkerPayload(): {
        params: Record<string, unknown>;
        serialNumber?: string;
    } {
        return dataService.sendIpcEvent.mock.calls.at(-1)?.[1];
    }
});
