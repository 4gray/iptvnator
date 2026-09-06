import {
    getAppPlaylistFavoriteChannels,
    getAppPlaylistMetas,
    getPlaylist,
    parseAppPlaylist,
    updatePlaylist,
} from './playlist.operations';
import type { AppDatabase } from '../database.types';

function createPlaylistFavoriteChannelsDbMock(row: unknown | null) {
    const limit = jest.fn().mockResolvedValue(row ? [row] : []);
    const where = jest.fn().mockReturnValue({ limit });
    const from = jest.fn().mockReturnValue({ where });
    const select = jest.fn().mockReturnValue({ from });

    return {
        db: {
            select,
        } as unknown as AppDatabase,
        from,
        limit,
        select,
        where,
    };
}

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

    it('projects the persisted server timezone from the payload onto DB_GET_PLAYLIST rows', async () => {
        const row = {
            id: 'playlist-1',
            name: 'Xtream Source',
            serverUrl: 'http://localhost:8080',
            username: 'demo',
            password: 'secret',
            type: 'xtream',
            payload: JSON.stringify({
                _id: 'playlist-1',
                title: 'Xtream Source',
                serverTimezone: 'Europe/London',
            }),
        };
        const { db } = createPlaylistFavoriteChannelsDbMock(row);

        await expect(getPlaylist(db, 'playlist-1')).resolves.toEqual({
            ...row,
            serverTimezone: 'Europe/London',
        });
    });

    it('returns DB_GET_PLAYLIST rows untouched when the payload carries no server timezone', async () => {
        const row = {
            id: 'playlist-1',
            name: 'Xtream Source',
            type: 'xtream',
            payload: JSON.stringify({ _id: 'playlist-1', serverTimezone: ' ' }),
        };
        const { db } = createPlaylistFavoriteChannelsDbMock(row);

        await expect(getPlaylist(db, 'playlist-1')).resolves.toBe(row);
        await expect(
            getPlaylist(createPlaylistFavoriteChannelsDbMock(null).db, 'gone')
        ).resolves.toBeNull();
    });

    it('drops the persisted server timezone from the payload when DB_UPDATE_PLAYLIST moves the source to another server', async () => {
        const payload = {
            _id: 'playlist-1',
            title: 'Xtream Source',
            serverTimezone: 'Europe/London',
            favorites: ['1'],
        };
        const read = createPlaylistFavoriteChannelsDbMock({
            serverUrl: 'http://old.example:8080',
            payload: JSON.stringify(payload),
        });
        const where = jest.fn().mockResolvedValue(undefined);
        const set = jest.fn().mockReturnValue({ where });
        const update = jest.fn().mockReturnValue({ set });
        const db = {
            select: read.select,
            update,
        } as unknown as AppDatabase;

        await expect(
            updatePlaylist(db, 'playlist-1', {
                name: 'Moved',
                serverUrl: 'http://new.example:8080',
            })
        ).resolves.toEqual({ success: true });
        expect(set).toHaveBeenCalledWith({
            name: 'Moved',
            serverUrl: 'http://new.example:8080',
            payload: JSON.stringify({
                _id: 'playlist-1',
                title: 'Xtream Source',
                favorites: ['1'],
            }),
        });

        set.mockClear();
        await updatePlaylist(db, 'playlist-1', {
            name: 'Renamed',
            serverUrl: 'http://old.example:8080',
        });
        expect(set).toHaveBeenCalledWith({
            name: 'Renamed',
            serverUrl: 'http://old.example:8080',
        });

        set.mockClear();
        read.select.mockClear();
        await updatePlaylist(db, 'playlist-1', { name: 'Only renamed' });
        expect(read.select).not.toHaveBeenCalled();
        expect(set).toHaveBeenCalledWith({ name: 'Only renamed' });
    });

    it('loads app playlist metadata without selecting the large payload column', async () => {
        const from = jest.fn().mockResolvedValue([
            {
                id: 'playlist-meta',
                name: 'Metadata Playlist',
                type: 'm3u-url',
                dateCreated: '2026-04-01T00:00:00.000Z',
                lastUpdated: null,
                count: 2,
                importDate: '2026-04-01T00:00:00.000Z',
                favorites: JSON.stringify(['channel-1']),
                recentlyViewed: JSON.stringify([{ id: 'recent-1' }]),
                epgUrls: JSON.stringify(['https://example.com/enabled.xml']),
                detectedEpgUrls: JSON.stringify([
                    'https://example.com/enabled.xml',
                    'https://example.com/detected-only.xml',
                ]),
                manualEpgUrls: JSON.stringify([
                    'https://example.com/manual.xml',
                ]),
                disabledEpgUrls: JSON.stringify([
                    'https://example.com/disabled.xml',
                ]),
                autoRefresh: false,
                url: 'https://example.com/list.m3u',
            },
        ]);
        const select = jest.fn().mockReturnValue({ from });
        const db = {
            select,
        } as unknown as AppDatabase;

        await expect(getAppPlaylistMetas(db)).resolves.toEqual([
            expect.objectContaining({
                _id: 'playlist-meta',
                title: 'Metadata Playlist',
                count: 2,
                favorites: ['channel-1'],
                recentlyViewed: [{ id: 'recent-1' }],
                epgUrls: ['https://example.com/enabled.xml'],
                detectedEpgUrls: [
                    'https://example.com/enabled.xml',
                    'https://example.com/detected-only.xml',
                ],
                manualEpgUrls: ['https://example.com/manual.xml'],
                disabledEpgUrls: ['https://example.com/disabled.xml'],
                url: 'https://example.com/list.m3u',
            }),
        ]);
        expect(select).toHaveBeenCalledWith(
            expect.not.objectContaining({
                payload: expect.anything(),
            })
        );
    });

    it('resolves M3U favorite channels in the worker without returning the full playlist payload', async () => {
        const firstChannel = {
            id: 'channel-1',
            name: 'Channel One',
            url: 'https://example.com/stream-1.m3u8',
            tvg: {
                id: 'tvg-1',
                name: 'Channel One',
                logo: 'https://example.com/logo-1.png',
            },
        };
        const secondChannel = {
            id: 'channel-2',
            name: 'Channel Two',
            url: 'https://example.com/stream-2.m3u8',
            tvg: {
                id: 'tvg-2',
                name: 'Channel Two',
                logo: 'https://example.com/logo-2.png',
            },
        };
        const { db } = createPlaylistFavoriteChannelsDbMock({
            id: 'playlist-1',
            favorites: JSON.stringify([
                'https://example.com/stream-2.m3u8',
                'channel-1',
                'missing-channel',
            ]),
            payload: JSON.stringify({
                playlist: {
                    items: [firstChannel, secondChannel],
                },
            }),
        });

        await expect(
            getAppPlaylistFavoriteChannels(db, 'playlist-1')
        ).resolves.toEqual([
            {
                favoriteId: 'https://example.com/stream-2.m3u8',
                favoriteIndex: 0,
                channel: secondChannel,
            },
            {
                favoriteId: 'channel-1',
                favoriteIndex: 1,
                channel: firstChannel,
            },
        ]);
    });
});
