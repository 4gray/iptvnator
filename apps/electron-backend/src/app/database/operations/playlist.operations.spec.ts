import { parseAppPlaylist } from './playlist.operations';

describe('playlist.operations', () => {
    it('hydrates updateDate from lastUpdated when payload is stale', async () => {
        const parsed = parseAppPlaylist({
            id: 'playlist-1',
            name: 'Refresh Xtream Source',
            serverUrl: 'http://localhost:8080',
            username: 'demo',
            password: 'secret',
            dateCreated: '2026-04-03T08:00:00.000Z',
            lastUpdated: '2026-04-03T11:15:00.000Z',
            type: 'xtream',
            autoRefresh: false,
            count: 0,
            importDate: '2026-04-03T08:00:00.000Z',
            payload: JSON.stringify({
                _id: 'playlist-1',
                title: 'Refresh Xtream Source',
                count: 0,
                importDate: '2026-04-03T08:00:00.000Z',
                autoRefresh: false,
                serverUrl: 'http://localhost:8080',
                username: 'demo',
                password: 'secret',
            }),
        } as any);

        expect(parsed).toEqual(
            expect.objectContaining({
                _id: 'playlist-1',
                updateDate: new Date('2026-04-03T11:15:00.000Z').getTime(),
            })
        );
    });
});
