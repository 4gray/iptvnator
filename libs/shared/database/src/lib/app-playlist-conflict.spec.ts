import { SQL } from 'drizzle-orm';
import { buildPlaylistRow } from './app-playlist-codec';
import { playlistConflictUpdate } from './app-playlist-conflict';
import type { NewPlaylist } from './schema';

function rowOf(document: Record<string, unknown>): NewPlaylist {
    const row = buildPlaylistRow(document);
    if (!row) {
        throw new Error('Expected the document to produce a row');
    }
    return row;
}

/** Every optional column of a document that only has an id, title and URL. */
const CLEARED_COLUMNS = {
    serverUrl: null,
    username: null,
    password: null,
    lastUpdated: null,
    userAgent: null,
    origin: null,
    referrer: null,
    filePath: null,
    epgUrls: null,
    detectedEpgUrls: null,
    manualEpgUrls: null,
    disabledEpgUrls: null,
    macAddress: null,
    portalUrl: null,
    count: null,
    importDate: null,
    updateDate: null,
    position: null,
    favorites: null,
    recentlyViewed: null,
};

describe('playlistConflictUpdate', () => {
    const document = {
        _id: 'm3u-1',
        title: 'Family',
        url: 'https://example.test/list.m3u',
        userAgent: '',
        referrer: '   ',
    };

    it('sets every optional column the document leaves empty to NULL', () => {
        const row = rowOf(document);

        expect(playlistConflictUpdate(row, document)).toMatchObject({
            ...CLEARED_COLUMNS,
            url: 'https://example.test/list.m3u',
        });
    });

    it('never clears the creation date or the columns every row carries', () => {
        const row = rowOf(document);
        const update = playlistConflictUpdate(row, document);

        expect(update).not.toHaveProperty('dateCreated');
        expect(update).toMatchObject({
            id: 'm3u-1',
            name: 'Family',
            type: 'm3u-url',
            autoRefresh: false,
            lastUsage: row.lastUsage,
        });
        // A clockless document keeps a stored panel clock through SQL.
        expect(update.payload).toBeInstanceOf(SQL);
    });

    it('clears the same columns when the document carries its own clock', () => {
        const withClock = { ...document, serverTimezone: 'UTC' };
        const row = rowOf(withClock);
        const update = playlistConflictUpdate(row, withClock);

        expect(update).toMatchObject(CLEARED_COLUMNS);
        expect(update.payload).toBe(row.payload);
    });
});
