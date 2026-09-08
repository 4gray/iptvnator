interface SetupOptions {
    accessError?: Error;
    cleanupError?: Error;
    claim?: { changes: number };
    fileReappeared?: boolean;
    playlistType?: 'xtream' | 'stalker';
    row?: Record<string, unknown> | null;
    urlError?: Error;
}

async function setup(options: SetupOptions = {}) {
    jest.resetModules();

    const row =
        options.row === null
            ? null
            : {
                  filePath: '/downloads/movie.mp4',
                  id: 42,
                  requestHeaders: JSON.stringify({
                      Authorization: 'not-allowed',
                      Referer: 'https://example.test/',
                      'User-Agent': 'IPTVnator',
                  }),
                  status: 'completed',
                  url: 'https://example.test/movie.mp4',
                  ...options.row,
              };
    const downloadLimit = jest.fn().mockResolvedValue(row ? [row] : []);
    const playlistLimit = jest
        .fn()
        .mockResolvedValue([{ type: options.playlistType ?? 'stalker' }]);
    const where = jest.fn().mockResolvedValue(options.claim ?? { changes: 1 });
    const set = jest.fn(() => ({ where }));
    const db = {
        select: jest.fn((selection?: unknown) => ({
            from: jest.fn(() => ({
                where: jest.fn(() => ({
                    limit: selection ? playlistLimit : downloadLimit,
                })),
            })),
        })),
        update: jest.fn(() => ({ set })),
    };
    const accessSync = jest.fn(() => {
        if (options.accessError) {
            throw options.accessError;
        }
    });
    const lstatSync = jest.fn(() => {
        if (!options.fileReappeared) {
            throw new Error('ENOENT');
        }
        return {
            isFile: () => true,
            isSymbolicLink: () => false,
        };
    });
    const assertRemoteUrlAllowed = jest.fn(async () => {
        if (options.urlError) {
            throw options.urlError;
        }
    });
    const removePartialDownloadFile = jest.fn(() => {
        if (options.cleanupError) {
            throw options.cleanupError;
        }
    });
    const enqueueDownload = jest.fn();
    const proof = { version: 1, phase: 'transfer' };
    const removeJournaledCatchupPartial = jest.fn((_path, _proof, record) =>
        record('/downloads/.iptvnator-cleanup-test/entry')
    );
    const recordArchiveCleanupPath = jest.fn();

    jest.doMock('node:fs', () => ({
        ...jest.requireActual<typeof import('node:fs')>('node:fs'),
        accessSync,
        lstatSync,
    }));
    jest.doMock('../../database/connection', () => ({
        getDatabase: jest.fn().mockResolvedValue(db),
    }));
    jest.doMock('../url-safety', () => ({ assertRemoteUrlAllowed }));
    jest.doMock('./download-file-path', () => ({ removePartialDownloadFile }));
    jest.doMock('./download-catchup-journal', () => ({
        recordArchiveCleanupPath,
        readArchiveFinalizations: jest
            .fn()
            .mockResolvedValue(new Map([[42, proof]])),
    }));
    jest.doMock('./download-catchup-removal', () => ({
        removeJournaledCatchupPartial,
    }));
    jest.doMock('./download-runtime', () => ({ enqueueDownload }));

    const { redownloadMissingRequest } = await import('./download-redownload');
    return {
        accessSync,
        assertRemoteUrlAllowed,
        enqueueDownload,
        removeJournaledCatchupPartial,
        proof,
        lstatSync,
        redownloadMissingRequest,
        removePartialDownloadFile,
        set,
        where,
    };
}

describe('redownload missing completed file', () => {
    it('requeues the managed row at its retained destination', async () => {
        const harness = await setup();

        await expect(harness.redownloadMissingRequest(42)).resolves.toEqual({
            success: true,
        });
        expect(harness.set).toHaveBeenCalledWith(
            expect.objectContaining({
                bytesDownloaded: 0,
                errorMessage: null,
                resumeValidator: null,
                status: 'queued',
                totalBytes: null,
            })
        );
        expect(harness.enqueueDownload).toHaveBeenCalledWith({
            directory: '/downloads',
            fileName: 'movie.mp4',
            filePath: '/downloads/movie.mp4',
            headers: {
                Referer: 'https://example.test/',
                'User-Agent': 'IPTVnator',
            },
            id: 42,
            resumeValidator: null,
            totalBytes: null,
            url: 'https://example.test/movie.mp4',
        });
    });

    it('reserves a fresh archive path and uses journal-backed previous-partial cleanup', async () => {
        const catchup = {
            channelName: 'News',
            startTimestamp: 100,
            stopTimestamp: 200,
        };
        const h = await setup({ row: { contentType: 'catchup', catchup } });
        await expect(h.redownloadMissingRequest(42)).resolves.toEqual({
            success: true,
        });
        expect(h.removeJournaledCatchupPartial).toHaveBeenCalledWith(
            '/downloads/movie.mp4',
            h.proof,
            expect.any(Function)
        );
        expect(h.removePartialDownloadFile).not.toHaveBeenCalled();
        expect(h.set).toHaveBeenCalledWith(
            expect.objectContaining({ status: 'queued', filePath: null })
        );
        expect(h.enqueueDownload).toHaveBeenCalledWith(
            expect.objectContaining({ catchup, filePath: null })
        );
    });

    it('adds the Xtream fallback User-Agent to a legacy row', async () => {
        const harness = await setup({
            playlistType: 'xtream',
            row: {
                playlistId: 'playlist-1',
                requestHeaders: null,
            },
        });

        await expect(harness.redownloadMissingRequest(42)).resolves.toEqual({
            success: true,
        });
        expect(harness.enqueueDownload).toHaveBeenCalledWith(
            expect.objectContaining({
                headers: {
                    'User-Agent': 'VLC/3.0.18 LibVLC/3.0.18',
                },
            })
        );
    });

    it('recovers a file that reappeared without updating or enqueueing', async () => {
        const harness = await setup({ fileReappeared: true });

        await expect(harness.redownloadMissingRequest(42)).resolves.toEqual({
            recovered: true,
            success: true,
        });
        expect(harness.set).not.toHaveBeenCalled();
        expect(harness.enqueueDownload).not.toHaveBeenCalled();
    });

    it('rejects a row that is no longer completed', async () => {
        const harness = await setup({ row: { status: 'queued' } });

        await expect(harness.redownloadMissingRequest(42)).resolves.toEqual({
            error: 'Can only re-download missing completed files',
            success: false,
        });
        expect(harness.lstatSync).not.toHaveBeenCalled();
        expect(harness.enqueueDownload).not.toHaveBeenCalled();
    });

    it('rejects an unknown row', async () => {
        const harness = await setup({ row: null });

        await expect(harness.redownloadMissingRequest(404)).resolves.toEqual({
            error: 'Download not found',
            success: false,
        });
        expect(harness.enqueueDownload).not.toHaveBeenCalled();
    });

    it.each([
        ['missing retained path', { row: { filePath: null } }],
        [
            'unavailable retained directory',
            { accessError: new Error('EACCES') },
        ],
    ])('rejects an %s', async (_label, options) => {
        const harness = await setup(options);

        await expect(harness.redownloadMissingRequest(42)).resolves.toEqual({
            error: 'Download folder is unavailable',
            success: false,
        });
        expect(harness.enqueueDownload).not.toHaveBeenCalled();
    });

    it('does not mutate or enqueue when the remote URL is unsafe', async () => {
        const unsafe = new Error('Blocked private destination');
        const harness = await setup({ urlError: unsafe });

        await expect(harness.redownloadMissingRequest(42)).rejects.toBe(unsafe);
        expect(harness.set).not.toHaveBeenCalled();
        expect(harness.removePartialDownloadFile).not.toHaveBeenCalled();
        expect(harness.enqueueDownload).not.toHaveBeenCalled();
    });

    it('keeps the completed row when partial cleanup fails', async () => {
        const harness = await setup({
            cleanupError: new Error('EPERM: locked'),
        });

        await expect(harness.redownloadMissingRequest(42)).resolves.toEqual({
            error: 'Could not delete the previous partial file',
            success: false,
        });
        expect(harness.set).not.toHaveBeenCalled();
        expect(harness.enqueueDownload).not.toHaveBeenCalled();
    });

    it('does not enqueue after losing the conditional completed-row claim', async () => {
        const harness = await setup({ claim: { changes: 0 } });

        await expect(harness.redownloadMissingRequest(42)).resolves.toEqual({
            error: 'Download is no longer recoverable',
            success: false,
        });
        expect(harness.enqueueDownload).not.toHaveBeenCalled();
    });
});
