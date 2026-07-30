import {
    decorateDownloadItem,
    getDownloadFileAvailability,
    isAvailableDownloadFile,
    type DownloadLstat,
} from './download-file-availability';

function lstatResult(options: {
    isFile: boolean;
    isSymbolicLink?: boolean;
}): DownloadLstat {
    return () => ({
        isFile: () => options.isFile,
        isSymbolicLink: () => options.isSymbolicLink ?? false,
    });
}

describe('download file availability', () => {
    it('marks only a completed regular non-symbolic-link file available', () => {
        const lstat = lstatResult({ isFile: true });

        expect(
            getDownloadFileAvailability(
                {
                    filePath: '/downloads/movie.mp4',
                    status: 'completed',
                },
                lstat
            )
        ).toBe('available');
        expect(
            isAvailableDownloadFile('/downloads/movie.mp4', lstat)
        ).toBe(true);
    });

    it.each([
        ['missing path', undefined, lstatResult({ isFile: true })],
        ['empty path', '', lstatResult({ isFile: true })],
        [
            'filesystem error',
            '/downloads/missing.mp4',
            (() => {
                throw new Error('ENOENT');
            }) as DownloadLstat,
        ],
        [
            'directory',
            '/downloads/folder',
            lstatResult({ isFile: false }),
        ],
        [
            'symbolic link',
            '/downloads/link.mp4',
            lstatResult({ isFile: true, isSymbolicLink: true }),
        ],
    ])('marks a completed %s missing', (_label, filePath, lstat) => {
        expect(
            getDownloadFileAvailability(
                { filePath, status: 'completed' },
                lstat
            )
        ).toBe('missing');
        expect(isAvailableDownloadFile(filePath, lstat)).toBe(false);
    });

    it('does not inspect unfinished downloads', () => {
        const lstat = jest.fn<ReturnType<DownloadLstat>, [string]>();

        expect(
            getDownloadFileAvailability(
                {
                    filePath: '/downloads/queued.mp4',
                    status: 'queued',
                },
                lstat
            )
        ).toBe('not-applicable');
        expect(lstat).not.toHaveBeenCalled();
    });

    it('decorates a row without mutating it', () => {
        const row = Object.freeze({
            filePath: '/downloads/movie.mp4',
            id: 42,
            status: 'completed' as const,
            title: 'Movie',
        });

        expect(decorateDownloadItem(row, lstatResult({ isFile: true }))).toEqual(
            {
                ...row,
                fileAvailability: 'available',
            }
        );
        expect(row).not.toHaveProperty('fileAvailability');
    });
});
