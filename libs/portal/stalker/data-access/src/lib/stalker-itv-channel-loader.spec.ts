import { DataService } from '@iptvnator/services';
import {
    PlaylistMeta,
    STALKER_REQUEST,
    StalkerPortalActions,
} from '@iptvnator/shared/interfaces';
import { StalkerSessionService } from './stalker-session.service';
import { loadFullItvChannelList } from './stalker-itv-channel-loader';

const PLAYLIST = {
    _id: 'playlist-1',
    title: 'Demo Stalker',
    count: 0,
    autoRefresh: false,
    importDate: '2026-07-27T00:00:00.000Z',
    portalUrl: 'https://portal.example/server/load.php',
    macAddress: '00:1A:79:00:00:01',
    isFullStalkerPortal: false,
} as PlaylistMeta;

describe('loadFullItvChannelList', () => {
    it('uses declared totalPages when total is absent', async () => {
        const sendIpcEvent = jest
            .fn()
            .mockResolvedValueOnce({ js: { data: [] } })
            .mockResolvedValueOnce({
                js: {
                    data: [
                        { id: '1', cmd: 'cmd-1', name: 'One' },
                        { id: '2', cmd: 'cmd-2', name: 'Two' },
                    ],
                    max_page_items: 2,
                    total_pages: 3,
                },
            })
            .mockResolvedValueOnce({
                js: {
                    data: [
                        { id: '3', cmd: 'cmd-3', name: 'Three' },
                        { id: '4', cmd: 'cmd-4', name: 'Four' },
                    ],
                    max_page_items: 2,
                    total_pages: 3,
                },
            })
            .mockResolvedValueOnce({
                js: {
                    data: [{ id: '5', cmd: 'cmd-5', name: 'Five' }],
                    max_page_items: 2,
                    total_pages: 3,
                },
            });

        const result = await loadFullItvChannelList(
            {
                dataService: {
                    sendIpcEvent,
                } as unknown as DataService,
                stalkerSession: {
                    supportsTypedSessions: jest.fn().mockReturnValue(true),
                    makeAuthenticatedRequest: jest.fn(),
                } as unknown as StalkerSessionService,
            },
            PLAYLIST,
            jest.fn(),
            {
                info: jest.fn(),
                warn: jest.fn(),
            }
        );

        expect(
            Array.isArray(result) ? result.map((item) => item.id) : result
        ).toEqual(['1', '2', '3', '4', '5']);
        expect(sendIpcEvent).toHaveBeenCalledTimes(4);
        expect(sendIpcEvent).toHaveBeenNthCalledWith(1, STALKER_REQUEST, {
            url: PLAYLIST.portalUrl,
            macAddress: PLAYLIST.macAddress,
            params: {
                action: StalkerPortalActions.GetAllChannels,
                type: 'itv',
            },
        });
        expect(
            sendIpcEvent.mock.calls
                .slice(1)
                .map(([, payload]) => payload.params.p)
                .sort()
        ).toEqual([1, 2, 3]);
    });
});
