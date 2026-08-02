import * as schema from '../../database/schema';
import type { DownloadsDatabase } from './download-task';
import { resolveExistingDownloadIdentity } from './download-request-identity';

type DownloadRow = typeof schema.downloads.$inferSelect;

const episodeRequest = {
    contentType: 'episode' as const,
    episodeNumber: 3,
    playlistId: 'playlist-1',
    seasonNumber: 2,
    seriesXtreamId: 100,
    xtreamId: 700,
};

function createDownloadRow(overrides: Partial<DownloadRow> = {}): DownloadRow {
    return {
        bytesDownloaded: 0,
        contentType: 'episode',
        createdAt: '2026-08-02 10:00:00',
        episodeNumber: 3,
        errorMessage: null,
        fileName: 'episode.mp4',
        filePath: null,
        id: 42,
        metadataSnapshot: null,
        playlistId: 'playlist-1',
        posterUrl: null,
        requestHeaders: null,
        resumeValidator: null,
        seasonNumber: 2,
        seriesXtreamId: 100,
        status: 'canceled',
        title: 'Episode 3',
        totalBytes: null,
        updatedAt: '2026-08-02 10:00:00',
        url: 'https://example.test/episode.mp4',
        xtreamId: 700,
        ...overrides,
    };
}

function createQueryHarness(
    canonicalRows: DownloadRow[],
    coordinateRows: DownloadRow[] = []
) {
    let queryIndex = 0;
    const limit = jest.fn((value: number) => {
        const rows = queryIndex === 0 ? canonicalRows : coordinateRows;
        queryIndex += 1;
        return Promise.resolve(rows.slice(0, value));
    });
    const where = jest.fn(() => ({ limit }));
    const from = jest.fn(() => ({ where }));
    const select = jest.fn(() => ({ from }));

    return {
        db: { select } as unknown as DownloadsDatabase,
        limit,
        select,
    };
}

describe('resolveExistingDownloadIdentity', () => {
    it('returns a canonical match without migration', async () => {
        const row = createDownloadRow();
        const harness = createQueryHarness([row], []);

        await expect(
            resolveExistingDownloadIdentity(harness.db, episodeRequest)
        ).resolves.toEqual({
            item: row,
            kind: 'match',
            migrateCanonicalId: false,
        });
        expect(harness.limit).toHaveBeenNthCalledWith(1, 1);
        expect(harness.limit).toHaveBeenNthCalledWith(2, 2);
    });

    it('returns a legacy coordinate match with canonical migration', async () => {
        const row = createDownloadRow({ xtreamId: 77 });
        const harness = createQueryHarness([], [row]);

        await expect(
            resolveExistingDownloadIdentity(harness.db, episodeRequest)
        ).resolves.toEqual({
            item: row,
            kind: 'match',
            migrateCanonicalId: true,
        });
    });

    it('fails closed when canonical and coordinate lookups find different rows', async () => {
        const harness = createQueryHarness(
            [createDownloadRow()],
            [createDownloadRow({ id: 43, xtreamId: 77 })]
        );

        await expect(
            resolveExistingDownloadIdentity(harness.db, episodeRequest)
        ).resolves.toEqual({ kind: 'conflict' });
    });

    it('fails closed when the canonical row has conflicting complete coordinates', async () => {
        const harness = createQueryHarness(
            [createDownloadRow({ episodeNumber: 4 })],
            []
        );

        await expect(
            resolveExistingDownloadIdentity(harness.db, episodeRequest)
        ).resolves.toEqual({ kind: 'conflict' });
    });

    it('fails closed when multiple rows share the legacy coordinates', async () => {
        const harness = createQueryHarness([], [
            createDownloadRow({ id: 42, xtreamId: 77 }),
            createDownloadRow({ id: 43, xtreamId: 78 }),
        ]);

        await expect(
            resolveExistingDownloadIdentity(harness.db, episodeRequest)
        ).resolves.toEqual({ kind: 'conflict' });
    });

    it('performs only the canonical lookup for VOD', async () => {
        const row = createDownloadRow({
            contentType: 'vod',
            episodeNumber: null,
            seasonNumber: null,
            seriesXtreamId: null,
        });
        const harness = createQueryHarness([row]);

        await expect(
            resolveExistingDownloadIdentity(harness.db, {
                contentType: 'vod',
                playlistId: episodeRequest.playlistId,
                xtreamId: episodeRequest.xtreamId,
            })
        ).resolves.toEqual({
            item: row,
            kind: 'match',
            migrateCanonicalId: false,
        });
        expect(harness.limit).toHaveBeenCalledTimes(1);
        expect(harness.limit).toHaveBeenCalledWith(1);
    });

    it.each([
        ['series id', { seriesXtreamId: undefined }],
        ['season number', { seasonNumber: undefined }],
        ['episode number', { episodeNumber: undefined }],
        ['unsafe series id', { seriesXtreamId: Number.MAX_SAFE_INTEGER + 1 }],
        ['unsafe season number', { seasonNumber: Number.NaN }],
        ['unsafe episode number', { episodeNumber: 1.5 }],
    ])(
        'performs only the canonical lookup when an episode has an incomplete or unsafe %s',
        async (_label, override) => {
            const row = createDownloadRow({
                episodeNumber: null,
                seasonNumber: null,
                seriesXtreamId: null,
            });
            const harness = createQueryHarness([row]);

            await expect(
                resolveExistingDownloadIdentity(harness.db, {
                    ...episodeRequest,
                    ...override,
                })
            ).resolves.toEqual({
                item: row,
                kind: 'match',
                migrateCanonicalId: false,
            });
            expect(harness.limit).toHaveBeenCalledTimes(1);
            expect(harness.limit).toHaveBeenCalledWith(1);
        }
    );

    it('lets the canonical match win when both lookups find the same row', async () => {
        const row = createDownloadRow();
        const harness = createQueryHarness([row], [row]);

        await expect(
            resolveExistingDownloadIdentity(harness.db, episodeRequest)
        ).resolves.toEqual({
            item: row,
            kind: 'match',
            migrateCanonicalId: false,
        });
    });

    it('returns none when neither lookup finds a row', async () => {
        const harness = createQueryHarness([], []);

        await expect(
            resolveExistingDownloadIdentity(harness.db, episodeRequest)
        ).resolves.toEqual({ kind: 'none' });
    });
});
