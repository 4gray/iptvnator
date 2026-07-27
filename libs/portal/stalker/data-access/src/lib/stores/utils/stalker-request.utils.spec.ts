import {
    type PlaylistMeta,
    STALKER_REQUEST,
} from '@iptvnator/shared/interfaces';
import { STALKER_RECIPE_CLASSIFIER_VERSION } from '@iptvnator/portal/stalker/protocol';
import {
    executeStalkerRequest,
    StalkerEndpointShapeRecoveryError,
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
            recoverEndpointShape: jest.fn().mockResolvedValue(undefined),
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
        stalkerRecipeClassifierVersion: STALKER_RECIPE_CLASSIFIER_VERSION,
        stalkerRequestRecipe: 'full-session',
        stalkerDeviceId1: 'has-device-id-1',
        stalkerDeviceId2: 'has-device-id-2',
        stalkerSerialNumber: 'has-serial',
        stalkerSignature1: 'has-signature-1',
        stalkerSignature2: 'has-signature-2',
        title: 'Full Stalker Portal',
    } as PlaylistMeta;
}

function currentStatelessPlaylist(): PlaylistMeta {
    return {
        _id: 'stalker-basic',
        isFullStalkerPortal: false,
        macAddress: 'has-mac-address',
        portalUrl: 'https://portal.example.test/server/load.php',
        stalkerRecipeClassifierVersion: STALKER_RECIPE_CLASSIFIER_VERSION,
        stalkerRequestRecipe: 'stateless-mac',
        title: 'Basic Stalker Portal',
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

    it.each([404, 405, 501])(
        'reclassifies a current stateless recipe after endpoint status %i and reissues through the promoted full session',
        async (status) => {
            const deps = createDeps(true);
            const playlist = currentStatelessPlaylist();
            const endpointFailure = {
                message: 'endpoint unavailable',
                status,
            };
            (
                deps.dataService.sendIpcEvent as jest.Mock
            ).mockRejectedValueOnce(endpointFailure);
            (
                deps.stalkerSession.recoverEndpointShape as jest.Mock
            ).mockResolvedValueOnce(fullPlaylist());

            await expect(
                executeStalkerRequest(deps, playlist, CATEGORY_PARAMS)
            ).resolves.toEqual({ js: [] });

            expect(
                deps.stalkerSession.recoverEndpointShape
            ).toHaveBeenCalledWith(
                expect.objectContaining({
                    _id: playlist._id,
                    lastUsage: '',
                })
            );
            expect(deps.dataService.sendIpcEvent).toHaveBeenCalledTimes(1);
            expect(
                deps.stalkerSession.makeAuthenticatedRequest
            ).toHaveBeenCalledTimes(1);
        }
    );

    it.each([
        '<!doctype html><html><body>Portal landing</body></html>',
        {},
    ])(
        'reclassifies a current stateless recipe after an incompatible endpoint envelope',
        async (incompatibleResponse) => {
            const deps = createDeps(true);
            const playlist = currentStatelessPlaylist();
            const rediscovered = {
                ...playlist,
                portalUrl: 'https://portal.example.test/portal.php',
            };
            (deps.dataService.sendIpcEvent as jest.Mock)
                .mockResolvedValueOnce(incompatibleResponse)
                .mockResolvedValueOnce({ js: [{ id: '7' }] });
            (
                deps.stalkerSession.recoverEndpointShape as jest.Mock
            ).mockResolvedValueOnce(rediscovered);

            await expect(
                executeStalkerRequest(deps, playlist, CATEGORY_PARAMS)
            ).resolves.toEqual({ js: [{ id: '7' }] });

            expect(
                deps.stalkerSession.recoverEndpointShape
            ).toHaveBeenCalledTimes(1);
            expect(deps.dataService.sendIpcEvent).toHaveBeenNthCalledWith(
                2,
                STALKER_REQUEST,
                {
                    url: rediscovered.portalUrl,
                    macAddress: rediscovered.macAddress,
                    params: CATEGORY_PARAMS,
                }
            );
        }
    );

    it('spends at most one reclassification budget when the rediscovered endpoint is also incompatible', async () => {
        const deps = createDeps(true);
        const playlist = currentStatelessPlaylist();
        const rediscovered = {
            ...playlist,
            portalUrl: 'https://portal.example.test/portal.php',
        };
        (deps.dataService.sendIpcEvent as jest.Mock).mockResolvedValue({});
        (
            deps.stalkerSession.recoverEndpointShape as jest.Mock
        ).mockResolvedValueOnce(rediscovered);

        await expect(
            executeStalkerRequest(deps, playlist, CATEGORY_PARAMS)
        ).rejects.toEqual(new StalkerEndpointShapeRecoveryError());

        expect(
            deps.stalkerSession.recoverEndpointShape
        ).toHaveBeenCalledTimes(1);
        expect(deps.dataService.sendIpcEvent).toHaveBeenCalledTimes(2);
    });

    it('fails closed when an incompatible HTTP 200 envelope cannot be reclassified', async () => {
        const deps = createDeps(true);
        const playlist = currentStatelessPlaylist();
        (deps.dataService.sendIpcEvent as jest.Mock).mockResolvedValue({});
        (
            deps.stalkerSession.recoverEndpointShape as jest.Mock
        ).mockRejectedValueOnce(new Error('provisional discovery failed'));

        await expect(
            executeStalkerRequest(deps, playlist, CATEGORY_PARAMS)
        ).rejects.toEqual(new StalkerEndpointShapeRecoveryError());

        expect(
            deps.stalkerSession.recoverEndpointShape
        ).toHaveBeenCalledTimes(1);
        expect(deps.dataService.sendIpcEvent).toHaveBeenCalledTimes(1);
    });

    it('preserves the original unsupported-status failure when reclassification fails', async () => {
        const deps = createDeps(true);
        const playlist = currentStatelessPlaylist();
        const endpointFailure = {
            message: 'endpoint unavailable',
            status: 404,
        };
        (
            deps.dataService.sendIpcEvent as jest.Mock
        ).mockRejectedValueOnce(endpointFailure);
        (
            deps.stalkerSession.recoverEndpointShape as jest.Mock
        ).mockRejectedValueOnce(new Error('provisional discovery failed'));

        await expect(
            executeStalkerRequest(deps, playlist, CATEGORY_PARAMS)
        ).rejects.toBe(endpointFailure);

        expect(
            deps.stalkerSession.recoverEndpointShape
        ).toHaveBeenCalledTimes(1);
        expect(deps.dataService.sendIpcEvent).toHaveBeenCalledTimes(1);
    });

    it('preserves the legacy PWA failure path without attempting recipe recovery', async () => {
        const deps = createDeps(false);
        const playlist = currentStatelessPlaylist();
        const endpointFailure = {
            message: 'endpoint unavailable',
            status: 404,
        };
        (
            deps.dataService.sendIpcEvent as jest.Mock
        ).mockRejectedValueOnce(endpointFailure);

        await expect(
            executeStalkerRequest(deps, playlist, CATEGORY_PARAMS)
        ).rejects.toBe(endpointFailure);

        expect(
            deps.stalkerSession.recoverEndpointShape
        ).not.toHaveBeenCalled();
        expect(deps.dataService.sendIpcEvent).toHaveBeenCalledTimes(1);
    });
});
