import {
    createPortalRequestFailureEnvelope,
    createStalkerAuthFailureMarker,
    type PlaylistMeta,
    STALKER_REQUEST,
} from '@iptvnator/shared/interfaces';
import { loadStalkerSearchPage } from './stalker-search-page';
import type { StalkerRequestDeps } from './stores/utils/stalker-request.utils';

describe('loadStalkerSearchPage', () => {
    const playlist: PlaylistMeta = {
        _id: 'portal-a',
        title: 'Fixture portal',
        count: 0,
        importDate: '',
        autoRefresh: false,
        portalUrl: 'https://portal.example.test/portal.php',
        macAddress: '02:00:00:00:00:01',
        isFullStalkerPortal: false,
    };
    const term = 'Fixture comet';
    const sendIpcEvent = jest.fn();
    const deps = {
        dataService: { sendIpcEvent },
        stalkerSession: { ensureToken: jest.fn().mockResolvedValue({}) },
    } as unknown as StalkerRequestDeps;
    const requestParams = {
        action: 'get_ordered_list',
        sortby: 'added',
        search: term,
        p: 2,
        max_page_items: 100,
        category: '*',
    };

    beforeEach(() => sendIpcEvent.mockReset());

    it('requests the chosen VOD page and normalizes artwork against the portal origin', async () => {
        sendIpcEvent.mockResolvedValue({
            js: {
                data: [{ id: '42', name: term, screenshot_uri: '/poster.jpg' }],
                total_items: 24,
            },
        });

        await expect(
            loadStalkerSearchPage(deps, playlist, 'vod', term, 2)
        ).resolves.toEqual({
            rawItems: [
                {
                    id: '42',
                    name: term,
                    screenshot_uri: 'https://portal.example.test/poster.jpg',
                },
            ],
            totalItems: 24,
        });
        expect(sendIpcEvent).toHaveBeenCalledWith(STALKER_REQUEST, {
            url: playlist.portalUrl,
            macAddress: playlist.macAddress,
            params: { ...requestParams, type: 'vod', genre: '0' },
        });
    });

    it('omits genre from series requests and forwards the silent option', async () => {
        sendIpcEvent.mockResolvedValue({ js: { data: [] } });

        await loadStalkerSearchPage(deps, playlist, 'series', term, 2, {
            silent: true,
        });

        expect(sendIpcEvent).toHaveBeenCalledWith(STALKER_REQUEST, {
            url: playlist.portalUrl,
            macAddress: playlist.macAddress,
            params: { ...requestParams, type: 'series' },
            silent: true,
        });
    });

    it.each([{ js: { data: [] } }, { js: [] }, { js: null }, { js: false }])(
        'preserves empty catalog response %j',
        async (response) => {
            sendIpcEvent.mockResolvedValue(response);

            await expect(
                loadStalkerSearchPage(deps, playlist, 'vod', term, 1)
            ).resolves.toEqual({ rawItems: [], totalItems: undefined });
        }
    );

    it.each([
        { js: { total_items: 0 } },
        { js: { data: null, total_items: 0 } },
    ])('preserves an explicit zero total in %j', async (response) => {
        sendIpcEvent.mockResolvedValue(response);

        await expect(
            loadStalkerSearchPage(deps, playlist, 'vod', term, 1)
        ).resolves.toEqual({ rawItems: [], totalItems: 0 });
    });

    it.each([
        '<html><title>Fixture proxy error</title></html>',
        { message: 'Fixture backend unavailable' },
        { js: {} },
        { js: { data: 'Fixture backend unavailable', total_items: 0 } },
    ])('rejects the malformed catalog response %j', async (response) => {
        sendIpcEvent.mockResolvedValue(response);

        await expect(
            loadStalkerSearchPage(deps, playlist, 'vod', term, 1)
        ).rejects.toThrow('Malformed Stalker search response');
    });

    it('rejects the shared authorization failure marker', async () => {
        sendIpcEvent.mockResolvedValue(
            createStalkerAuthFailureMarker('Authorization failed.')
        );

        await expect(
            loadStalkerSearchPage(deps, playlist, 'vod', term, 1)
        ).rejects.toThrow('Stalker search authorization failed');
    });

    it.each([
        createPortalRequestFailureEnvelope({ kind: 'cancelled' }),
        { status: 503 },
        { js: { error: 'Fixture failure' } },
    ])('rejects the structured failure %j', async (response) => {
        sendIpcEvent.mockResolvedValue(response);

        await expect(
            loadStalkerSearchPage(deps, playlist, 'vod', term, 1)
        ).rejects.toThrow();
    });

    it('propagates a transport rejection', async () => {
        const failure = new Error('Fixture transport failure');
        sendIpcEvent.mockRejectedValue(failure);

        await expect(
            loadStalkerSearchPage(deps, playlist, 'vod', term, 1)
        ).rejects.toBe(failure);
    });
});
