import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    findAvailableFinalPath,
    getPartialDownloadPath,
    getPartialDownloadSize,
    removePartialDownload,
    removePartialDownloadFile,
    reserveAvailablePartialDownloadFile,
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

describe('reserveAvailablePartialDownloadFile', () => {
    it('reserves a .part path while keeping the final path free', () => {
        const reserveFile = jest.fn();

        expect(
            reserveAvailablePartialDownloadFile(
                '/downloads',
                'movie.mp4',
                reserveFile,
                () => false
            )
        ).toEqual({
            filename: 'movie.mp4',
            partialPath: join('/downloads', 'movie.mp4.part'),
            path: join('/downloads', 'movie.mp4'),
        });
        expect(reserveFile).toHaveBeenCalledWith(
            join('/downloads', 'movie.mp4.part')
        );
    });

    it('skips candidates when the final file already exists', () => {
        const reserveFile = jest.fn();

        expect(
            reserveAvailablePartialDownloadFile(
                '/downloads',
                'movie.mp4',
                reserveFile,
                (filePath) => filePath.endsWith('movie.mp4')
            )
        ).toEqual({
            filename: 'movie (1).mp4',
            partialPath: join('/downloads', 'movie (1).mp4.part'),
            path: join('/downloads', 'movie (1).mp4'),
        });
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

describe('partial download helpers', () => {
    it('derives, removes, and sizes .part files from the final path', () => {
        const finalPath = join('/downloads', 'movie.mp4');
        const partialPath = join('/downloads', 'movie.mp4.part');
        const removeFile = jest.fn();

        expect(getPartialDownloadPath(finalPath)).toBe(partialPath);
        expect(
            removePartialDownloadFile(
                finalPath,
                (filePath) => filePath === partialPath,
                removeFile
            )
        ).toBe(true);
        expect(removeFile).toHaveBeenCalledWith(partialPath);
        expect(
            getPartialDownloadSize(finalPath, (filePath) => {
                expect(filePath).toBe(partialPath);
                return { size: 128 };
            })
        ).toBe(128);
    });

    it('refuses to size a .part that is not a regular file', () => {
        const directory = mkdtempSync(join(tmpdir(), 'iptvnator-part-'));
        const finalPath = join(directory, 'movie.mp4');
        const partialPath = `${finalPath}.part`;

        try {
            writeFileSync(join(directory, 'target.bin'), 'attacker');
            symlinkSync(join(directory, 'target.bin'), partialPath);

            expect(() => getPartialDownloadSize(finalPath)).toThrow(
                'not a regular file'
            );
        } finally {
            rmSync(directory, { force: true, recursive: true });
        }
    });

    it('finds the next numbered destination whose final and partial paths are free', () => {
        const occupied = new Set([
            join('/downloads', 'movie.mp4'),
            join('/downloads', 'movie (1).mp4'),
            join('/downloads', 'movie (2).mp4.part'),
        ]);

        expect(
            findAvailableFinalPath(join('/downloads', 'movie.mp4'), (path) =>
                occupied.has(path)
            )
        ).toEqual({
            filename: 'movie (3).mp4',
            path: join('/downloads', 'movie (3).mp4'),
        });
    });

    it('reports zero for a missing .part with the default stat reader', () => {
        const directory = mkdtempSync(join(tmpdir(), 'iptvnator-part-'));

        try {
            expect(
                getPartialDownloadSize(join(directory, 'missing.mp4'))
            ).toBe(0);
        } finally {
            rmSync(directory, { force: true, recursive: true });
        }
    });
});
