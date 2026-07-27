import { DataService } from '@iptvnator/services';
import {
    Playlist,
    STALKER_REQUEST,
    StalkerPortalActions,
} from '@iptvnator/shared/interfaces';
import { StalkerSessionService } from '@iptvnator/portal/stalker/data-access';
import { executeStalkerSearchRequest } from './stalker-search-request.utils';

const REQUEST_PARAMS = {
    action: StalkerPortalActions.GetOrderedList,
    type: 'vod',
    sortby: 'added',
    search: 'matrix',
    p: 1,
    max_page_items: 100,
    category: '*',
    genre: '0',
};

function playlist(portalUrl: string): Playlist {
    return {
        _id: 'stalker-1',
        title: 'Stalker',
        count: 0,
        autoRefresh: false,
        importDate: '2026-07-27T00:00:00.000Z',
        lastUsage: '',
        portalUrl,
        macAddress: '00:1A:79:00:00:01',
    };
}

describe('executeStalkerSearchRequest', () => {
    it('routes a detected full portal through the typed session facade', async () => {
        const dataService = {
            sendIpcEvent: jest.fn(),
        };
        const stalkerSession = {
            isFullStalkerPortal: jest.fn().mockReturnValue(true),
            supportsTypedSessions: jest.fn().mockReturnValue(true),
            makeAuthenticatedRequest: jest
                .fn()
                .mockResolvedValue({ js: { data: [] } }),
        };

        await executeStalkerSearchRequest(
            {
                dataService: dataService as unknown as DataService,
                stalkerSession:
                    stalkerSession as unknown as StalkerSessionService,
            },
            playlist('https://portal.example/server/load.php'),
            REQUEST_PARAMS
        );

        expect(stalkerSession.makeAuthenticatedRequest).toHaveBeenCalledWith(
            expect.objectContaining({
                _id: 'stalker-1',
                isFullStalkerPortal: true,
            }),
            REQUEST_PARAMS
        );
        expect(dataService.sendIpcEvent).not.toHaveBeenCalled();
    });

    it('keeps simple portal search on the exact legacy IPC payload', async () => {
        const dataService = {
            sendIpcEvent: jest.fn().mockResolvedValue({ js: { data: [] } }),
        };
        const stalkerSession = {
            isFullStalkerPortal: jest.fn().mockReturnValue(false),
            supportsTypedSessions: jest.fn().mockReturnValue(true),
            makeAuthenticatedRequest: jest.fn(),
        };
        const simplePlaylist = playlist('https://portal.example/portal.php');

        await executeStalkerSearchRequest(
            {
                dataService: dataService as unknown as DataService,
                stalkerSession:
                    stalkerSession as unknown as StalkerSessionService,
            },
            simplePlaylist,
            REQUEST_PARAMS
        );

        expect(dataService.sendIpcEvent).toHaveBeenCalledWith(STALKER_REQUEST, {
            url: simplePlaylist.portalUrl,
            macAddress: simplePlaylist.macAddress,
            params: REQUEST_PARAMS,
        });
        expect(stalkerSession.makeAuthenticatedRequest).not.toHaveBeenCalled();
    });
});
