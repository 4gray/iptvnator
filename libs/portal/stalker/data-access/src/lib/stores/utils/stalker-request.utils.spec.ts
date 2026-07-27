import {
    type PlaylistMeta,
    STALKER_REQUEST,
} from '@iptvnator/shared/interfaces';
import {
    executeStalkerRequest,
    type StalkerRequestDeps,
} from './stalker-request.utils';

const CATEGORY_PARAMS = {
    action: 'get_genres',
    type: 'itv',
};

function createDeps(typedSessionsAvailable: boolean): StalkerRequestDeps {
    return {
        dataService: {
            sendIpcEvent: jest.fn().mockResolvedValue({ js: [] }),
        },
        stalkerSession: {
            makeAuthenticatedRequest: jest.fn().mockResolvedValue({ js: [] }),
            supportsTypedSessions: jest
                .fn()
                .mockReturnValue(typedSessionsAvailable),
        },
    } as unknown as StalkerRequestDeps;
}

function fullPlaylist(): PlaylistMeta {
    return {
        _id: 'stalker-full',
        isFullStalkerPortal: true,
        macAddress: 'has-mac-address',
        portalUrl: 'https://portal.example.test/stalker_portal/server/load.php',
        stalkerRequestRecipe: 'full-session',
        stalkerDeviceId1: 'has-device-id-1',
        stalkerDeviceId2: 'has-device-id-2',
        stalkerSerialNumber: 'has-serial',
        stalkerSignature1: 'has-signature-1',
        stalkerSignature2: 'has-signature-2',
        title: 'Full Stalker Portal',
    } as PlaylistMeta;
}

describe('executeStalkerRequest', () => {
    it('routes a full Electron portal through the typed session compatibility adapter', async () => {
        const deps = createDeps(true);
        const playlist = fullPlaylist();

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

    it('keeps a simple/stateless portal byte-compatible on STALKER_REQUEST even when typed sessions exist', async () => {
        const deps = createDeps(true);
        const playlist = {
            _id: 'stalker-basic',
            isFullStalkerPortal: false,
            macAddress: 'has-mac-address',
            portalUrl: 'https://portal.example.test/load.php',
            stalkerRequestRecipe: 'stateless-mac',
            title: 'Basic Stalker Portal',
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
            (deps.dataService.sendIpcEvent as jest.Mock).mock.calls[0]?.[1]
                ?.params
        ).toBe(CATEGORY_PARAMS);
        expect(
            deps.stalkerSession.makeAuthenticatedRequest
        ).not.toHaveBeenCalled();
    });

    it('lets the verified full-session recipe override a stale false compatibility flag', async () => {
        const deps = createDeps(true);
        const playlist = {
            ...fullPlaylist(),
            isFullStalkerPortal: false,
        };

        await executeStalkerRequest(deps, playlist, CATEGORY_PARAMS);

        expect(
            deps.stalkerSession.makeAuthenticatedRequest
        ).toHaveBeenCalled();
        expect(deps.dataService.sendIpcEvent).not.toHaveBeenCalled();
    });

    it('lets the verified stateless recipe override a stale true compatibility flag', async () => {
        const deps = createDeps(true);
        const playlist = {
            ...fullPlaylist(),
            isFullStalkerPortal: true,
            stalkerRequestRecipe: 'stateless-mac' as const,
        };

        await executeStalkerRequest(deps, playlist, CATEGORY_PARAMS);

        expect(deps.dataService.sendIpcEvent).toHaveBeenCalled();
        expect(
            deps.stalkerSession.makeAuthenticatedRequest
        ).not.toHaveBeenCalled();
    });

    it('does not infer a typed runtime path from the legacy boolean when recipe migration is still pending', async () => {
        const deps = createDeps(true);
        const playlist = {
            ...fullPlaylist(),
            stalkerRequestRecipe: undefined,
        };

        await executeStalkerRequest(deps, playlist, CATEGORY_PARAMS);

        expect(deps.dataService.sendIpcEvent).toHaveBeenCalled();
        expect(
            deps.stalkerSession.makeAuthenticatedRequest
        ).not.toHaveBeenCalled();
    });

    it('keeps the PWA adapter byte-compatible on STALKER_REQUEST even for a persisted full-portal row', async () => {
        const deps = createDeps(false);
        const playlist = fullPlaylist();

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
            (deps.dataService.sendIpcEvent as jest.Mock).mock.calls[0]?.[1]
                ?.params
        ).toBe(CATEGORY_PARAMS);
        expect(
            deps.stalkerSession.makeAuthenticatedRequest
        ).not.toHaveBeenCalled();
    });
});
