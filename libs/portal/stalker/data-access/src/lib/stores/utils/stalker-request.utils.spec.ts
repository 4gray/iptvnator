import { PlaylistMeta, STALKER_REQUEST } from '@iptvnator/shared/interfaces';
import {
    executeStalkerRequest,
    type StalkerPortalRepairApi,
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

describe('executeStalkerRequest portal-mode fallback', () => {
    it('authenticates legacy rows with an undefined flag but a canonical URL', async () => {
        // The historical import predicate persisted nothing for some rows;
        // the shared predicate must fall back to the URL rule instead of
        // silently skipping authentication (the #850 failure shape).
        const deps = createDeps();
        const playlist = {
            _id: 'stalker-legacy',
            title: 'Legacy row',
            portalUrl: 'https://portal.example.test/server/load.php',
            macAddress: 'has-mac-address',
        } as PlaylistMeta;

        await executeStalkerRequest(deps, playlist, CATEGORY_PARAMS);

        expect(deps.stalkerSession.makeAuthenticatedRequest).toHaveBeenCalled();
        expect(deps.dataService.sendIpcEvent).not.toHaveBeenCalled();
    });
});

describe('executeStalkerRequest lazy portal repair', () => {
    const PLAYLIST = {
        _id: 'stalker-misclassified',
        title: 'Misclassified portal',
        portalUrl: 'https://portal.example.test/server/load.php',
        macAddress: 'has-mac-address',
        isFullStalkerPortal: false,
    } as PlaylistMeta;

    function createRepair(
        overrides: Partial<StalkerPortalRepairApi> = {}
    ): StalkerPortalRepairApi {
        return {
            applyOverride: jest.fn((playlist) => playlist),
            shouldAttemptRepair: jest.fn().mockReturnValue(false),
            repairPortal: jest.fn().mockResolvedValue(null),
            ...overrides,
        } as StalkerPortalRepairApi;
    }

    it('retries once against the repaired configuration after an auth-failure body', async () => {
        const deps = createDeps();
        deps.dataService.sendIpcEvent = jest
            .fn()
            .mockResolvedValue('Authorization failed.');
        const repaired = {
            ...PLAYLIST,
            isFullStalkerPortal: true,
        } as PlaylistMeta;
        deps.portalRepair = createRepair({
            shouldAttemptRepair: jest.fn(
                (_playlist, failure) => failure === 'Authorization failed.'
            ),
            repairPortal: jest.fn().mockResolvedValue(repaired),
        });

        const response = await executeStalkerRequest(
            deps,
            PLAYLIST,
            CATEGORY_PARAMS
        );

        // The retry ran in full-portal mode against the repaired row.
        expect(
            deps.stalkerSession.makeAuthenticatedRequest
        ).toHaveBeenCalledWith(
            expect.objectContaining({ isFullStalkerPortal: true }),
            CATEGORY_PARAMS
        );
        expect(response).toEqual({ js: [] });
    });

    it('returns the raw response when the repair declines to change anything', async () => {
        const deps = createDeps();
        deps.dataService.sendIpcEvent = jest
            .fn()
            .mockResolvedValue('Authorization failed.');
        deps.portalRepair = createRepair({
            shouldAttemptRepair: jest.fn().mockReturnValue(true),
        });

        const response = await executeStalkerRequest(
            deps,
            PLAYLIST,
            CATEGORY_PARAMS
        );

        expect(response).toBe('Authorization failed.');
        expect(deps.dataService.sendIpcEvent).toHaveBeenCalledTimes(1);
    });

    it('repairs after a thrown transport error and rethrows when nothing changed', async () => {
        const deps = createDeps();
        const notFound = { message: 'HTTP Error: Not Found', status: 404 };
        deps.dataService.sendIpcEvent = jest.fn().mockRejectedValue(notFound);
        const repair = createRepair({
            shouldAttemptRepair: jest.fn().mockReturnValue(true),
        });
        deps.portalRepair = repair;

        await expect(
            executeStalkerRequest(deps, PLAYLIST, CATEGORY_PARAMS)
        ).rejects.toBe(notFound);
        expect(repair.repairPortal).toHaveBeenCalledWith(PLAYLIST);
    });

    it('applies an existing override before dispatching', async () => {
        const deps = createDeps();
        const repaired = {
            ...PLAYLIST,
            isFullStalkerPortal: true,
        } as PlaylistMeta;
        deps.portalRepair = createRepair({
            applyOverride: jest.fn().mockReturnValue(repaired),
        });

        await executeStalkerRequest(deps, PLAYLIST, CATEGORY_PARAMS);

        expect(
            deps.stalkerSession.makeAuthenticatedRequest
        ).toHaveBeenCalled();
        expect(deps.dataService.sendIpcEvent).not.toHaveBeenCalled();
    });

    it('never repairs on healthy responses', async () => {
        const deps = createDeps();
        const repair = createRepair();
        deps.portalRepair = repair;

        await executeStalkerRequest(deps, PLAYLIST, CATEGORY_PARAMS);

        expect(repair.shouldAttemptRepair).toHaveBeenCalledWith(PLAYLIST, {
            js: [],
        });
        expect(repair.repairPortal).not.toHaveBeenCalled();
    });
});
