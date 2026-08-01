import type { DownloadsDatabase } from './download-task';

function createDatabase(playlistType?: 'xtream' | 'stalker') {
    const limit = jest
        .fn()
        .mockResolvedValue(playlistType ? [{ type: playlistType }] : []);
    const db = {
        select: jest.fn(() => ({
            from: jest.fn(() => ({
                where: jest.fn(() => ({ limit })),
            })),
        })),
    } as unknown as DownloadsDatabase;
    return { db, select: db.select };
}

describe('stored download request headers', () => {
    it('adds the provider-compatible fallback for a legacy Xtream row', async () => {
        const { db } = createDatabase('xtream');
        const { resolveStoredDownloadHeaders } =
            await import('./download-request-headers');

        await expect(
            resolveStoredDownloadHeaders(db, {
                playlistId: 'playlist-1',
                requestHeaders: JSON.stringify({
                    Authorization: 'not-allowed',
                    Referer: 'https://example.test/',
                }),
            })
        ).resolves.toEqual({
            Referer: 'https://example.test/',
            'User-Agent': 'VLC/3.0.18 LibVLC/3.0.18',
        });
    });

    it('does not add the Xtream fallback to a Stalker row', async () => {
        const { db } = createDatabase('stalker');
        const { resolveStoredDownloadHeaders } =
            await import('./download-request-headers');

        await expect(
            resolveStoredDownloadHeaders(db, {
                playlistId: 'playlist-1',
                requestHeaders: null,
            })
        ).resolves.toBeUndefined();
    });

    it('adds the player fallback when a legacy row outlives its deleted source', async () => {
        const { db } = createDatabase();
        const { resolveStoredDownloadHeaders } =
            await import('./download-request-headers');

        await expect(
            resolveStoredDownloadHeaders(db, {
                playlistId: 'deleted-playlist',
                requestHeaders: null,
            })
        ).resolves.toEqual({
            'User-Agent': 'VLC/3.0.18 LibVLC/3.0.18',
        });
    });

    it('preserves an explicit stored User-Agent without querying the playlist', async () => {
        const { db, select } = createDatabase('xtream');
        const { resolveStoredDownloadHeaders } =
            await import('./download-request-headers');

        await expect(
            resolveStoredDownloadHeaders(db, {
                playlistId: 'playlist-1',
                requestHeaders: JSON.stringify({
                    'User-Agent': 'Custom/1.0',
                }),
            })
        ).resolves.toEqual({ 'User-Agent': 'Custom/1.0' });
        expect(select).not.toHaveBeenCalled();
    });
});
