import { join } from 'node:path';
import {
    removePartialDownload,
    reserveAvailableDownloadFile,
} from './download-file-path';

describe('reserveAvailableDownloadFile', () => {
    it('atomically reserves the requested filename when it is unused', () => {
        const reserveFile = jest.fn();

        expect(
            reserveAvailableDownloadFile('/downloads', 'movie.mp4', reserveFile)
        ).toEqual({
            filename: 'movie.mp4',
            path: join('/downloads', 'movie.mp4'),
        });
        expect(reserveFile).toHaveBeenCalledWith(
            join('/downloads', 'movie.mp4')
        );
    });

    it('retries with a numbered filename after exclusive-create collisions', () => {
        const reserveFile = jest.fn((filePath: string) => {
            if (!filePath.endsWith('movie (2).mp4')) {
                const error = new Error(
                    'already exists'
                ) as NodeJS.ErrnoException;
                error.code = 'EEXIST';
                throw error;
            }
        });

        expect(
            reserveAvailableDownloadFile('/downloads', 'movie.mp4', reserveFile)
        ).toEqual({
            filename: 'movie (2).mp4',
            path: join('/downloads', 'movie (2).mp4'),
        });
        expect(reserveFile).toHaveBeenCalledTimes(3);
    });

    it('does not hide non-collision filesystem errors', () => {
        const error = new Error('permission denied') as NodeJS.ErrnoException;
        error.code = 'EACCES';

        expect(() =>
            reserveAvailableDownloadFile('/downloads', 'movie.mp4', () => {
                throw error;
            })
        ).toThrow(error);
    });
});

describe('removePartialDownload', () => {
    it('removes only the actual partial save path', () => {
        const requestedPath = join('/downloads', 'movie.mp4');
        const partialPath = join('/downloads', 'movie (1).mp4');
        const removeFile = jest.fn();

        expect(
            removePartialDownload(
                { getSavePath: () => partialPath },
                (filePath) => filePath === partialPath,
                removeFile
            )
        ).toBe(true);
        expect(removeFile).toHaveBeenCalledWith(partialPath);
        expect(removeFile).not.toHaveBeenCalledWith(requestedPath);
    });

    it('does not remove a missing or unavailable partial path', () => {
        const removeFile = jest.fn();

        expect(
            removePartialDownload(
                { getSavePath: () => '' },
                () => true,
                removeFile
            )
        ).toBe(false);
        expect(
            removePartialDownload(
                { getSavePath: () => '/downloads/missing.mp4' },
                () => false,
                removeFile
            )
        ).toBe(false);
        expect(removeFile).not.toHaveBeenCalled();
    });
});
