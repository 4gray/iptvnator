import {
    buildPlaylistRow,
    parseAppPlaylist,
    PLAYLIST_TYPES,
} from './app-playlist-codec';
import type { NewPlaylist, Playlist as PlaylistRow } from './schema';

function rowOf(document: Record<string, unknown>): NewPlaylist {
    const row = buildPlaylistRow(document);
    if (!row) {
        throw new Error('Expected the document to produce a row');
    }
    return row;
}

/** What SQLite hands back for a row written from `row`. */
function storedRow(row: NewPlaylist, payload?: string | null): PlaylistRow {
    const nullable = Object.fromEntries(
        Object.entries(row).map(([key, value]) => [key, value ?? null])
    );
    return {
        dateCreated: '2026-10-01 00:00:00',
        ...nullable,
        payload: payload === undefined ? (row.payload ?? null) : payload,
    } as PlaylistRow;
}

describe('app playlist codec', () => {
    const m3uDocument = {
        _id: 'm3u-1',
        title: 'Family',
        url: 'https://example.test/list.m3u',
        count: 1,
        importDate: '2026-10-01T00:00:00.000Z',
        lastUsage: '2026-10-02T00:00:00.000Z',
        favorites: ['https://example.test/a'],
        recentlyViewed: [],
        autoRefresh: true,
        hiddenGroupTitles: ['Adult'],
        playlist: {
            header: { raw: '#EXTM3U' },
            items: [
                {
                    id: 'a',
                    url: 'https://example.test/a',
                    raw: '#EXTINF:-1,A',
                },
            ],
        },
    };

    it('round-trips an M3U document through a stored row', () => {
        const row = rowOf(m3uDocument);

        expect(row).toMatchObject({
            id: 'm3u-1',
            name: 'Family',
            type: PLAYLIST_TYPES.M3U_URL,
            url: 'https://example.test/list.m3u',
            autoRefresh: true,
            count: 1,
        });
        expect(parseAppPlaylist(storedRow(row))).toMatchObject({
            _id: 'm3u-1',
            title: 'Family',
            favorites: ['https://example.test/a'],
            hiddenGroupTitles: ['Adult'],
            playlist: m3uDocument.playlist,
        });
    });

    it('reads metadata from columns when the payload is not selected', () => {
        const row = rowOf(m3uDocument);
        const meta = parseAppPlaylist(storedRow(row, null));

        expect(meta).toMatchObject({
            _id: 'm3u-1',
            title: 'Family',
            count: 1,
            favorites: ['https://example.test/a'],
            url: 'https://example.test/list.m3u',
        });
        expect(meta['playlist']).toBeUndefined();
    });

    it('infers the provider type from the document', () => {
        expect(
            buildPlaylistRow({ _id: 'x', serverUrl: 'http://panel.test' })?.type
        ).toBe(PLAYLIST_TYPES.XTREAM);
        expect(
            buildPlaylistRow({
                _id: 's',
                macAddress: '00:1A:79:00:00:01',
                portalUrl: 'http://portal.test/c',
            })
        ).toMatchObject({
            type: PLAYLIST_TYPES.STALKER,
            url: 'http://portal.test/c',
        });
        expect(
            buildPlaylistRow({ _id: 'f', filePath: '/tmp/list.m3u' })?.type
        ).toBe(PLAYLIST_TYPES.M3U_FILE);
        expect(buildPlaylistRow({ _id: 't' })?.type).toBe(
            PLAYLIST_TYPES.M3U_TEXT
        );
    });

    it('refuses a document without an id', () => {
        expect(buildPlaylistRow({ title: 'No id' })).toBeNull();
    });

    it('never logs the content of a malformed stored value', () => {
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {
            /* silenced */
        });
        try {
            const row = rowOf(m3uDocument);
            parseAppPlaylist(
                storedRow(row, '{"title":"x","password":hunter2-secret}')
            );

            const logged = warn.mock.calls
                .flat()
                .map((arg) =>
                    arg instanceof Error
                        ? `${arg.name}: ${arg.message} ${arg.stack}`
                        : String(arg)
                )
                .join(' ');
            expect(warn).toHaveBeenCalled();
            expect(logged).not.toContain('hunter2');
        } finally {
            warn.mockRestore();
        }
    });
});
