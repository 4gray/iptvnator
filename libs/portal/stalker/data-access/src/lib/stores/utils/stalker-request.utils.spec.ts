import { PlaylistMeta, STALKER_REQUEST } from '@iptvnator/shared/interfaces';
import {
    executeStalkerRequest,
    type StalkerRequestDeps,
} from './stalker-request.utils';

const CATEGORY_PARAMS = {
    type: 'itv',
    action: 'get_genres',
};

function createDeps(): StalkerRequestDeps {
    return {
        dataService: {
            sendIpcEvent: jest.fn().mockResolvedValue({ js: [] }),
        },
        stalkerSession: {
            makeAuthenticatedRequest: jest.fn().mockResolvedValue({ js: [] }),
        },
    } as unknown as StalkerRequestDeps;
}

describe('executeStalkerRequest', () => {
    it('routes full Stalker portal category requests through the authenticated session path', async () => {
        const deps = createDeps();
        const playlist = {
            _id: 'stalker-full',
            title: 'Full Stalker Portal',
            portalUrl:
                'https://portal.example.test/stalker_portal/server/load.php',
            macAddress: 'has-mac-address',
            isFullStalkerPortal: true,
            stalkerSerialNumber: 'has-serial',
            stalkerDeviceId1: 'has-device-id-1',
            stalkerDeviceId2: 'has-device-id-2',
            stalkerSignature1: 'has-signature-1',
            stalkerSignature2: 'has-signature-2',
        } as PlaylistMeta;

        await executeStalkerRequest(deps, playlist, CATEGORY_PARAMS);

        expect(
            deps.stalkerSession.makeAuthenticatedRequest
        ).toHaveBeenCalledWith(
            expect.objectContaining({
                ...playlist,
                lastUsage: '',
            }),
            CATEGORY_PARAMS
        );
        expect(deps.dataService.sendIpcEvent).not.toHaveBeenCalled();
    });

    it('keeps lightweight Stalker portal requests on the IPC path', async () => {
        const deps = createDeps();
        const playlist = {
            _id: 'stalker-basic',
            title: 'Basic Stalker Portal',
            portalUrl: 'https://portal.example.test/load.php',
            macAddress: 'has-mac-address',
            isFullStalkerPortal: false,
        } as PlaylistMeta;

        await executeStalkerRequest(deps, playlist, CATEGORY_PARAMS);

        expect(deps.dataService.sendIpcEvent).toHaveBeenCalledWith(
            STALKER_REQUEST,
            {
                url: playlist.portalUrl,
                macAddress: playlist.macAddress,
                params: CATEGORY_PARAMS,
            }
        );
        expect(
            deps.stalkerSession.makeAuthenticatedRequest
        ).not.toHaveBeenCalled();
    });
});
