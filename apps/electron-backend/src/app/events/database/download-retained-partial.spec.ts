import { PassThrough } from 'node:stream';
import { createTask, waitForStatus } from './download.test-helpers';

describe('retained completed partials', () => {
    it('finalizes a retained completed partial without another HTTP request', async () => {
        jest.resetModules();

        const set = jest.fn(() => ({ where: jest.fn().mockResolvedValue(undefined) }));
        const db = {
            update: jest.fn(() => ({ set })),
        };
        const requestWithValidatedRedirects = jest.fn();
        const link = jest.fn(async () => undefined);
        const unlink = jest.fn(async () => undefined);

        jest.doMock('../../database/connection', () => ({
            getDatabase: jest.fn().mockResolvedValue(db),
        }));
        jest.doMock('../../util/validated-axios', () => ({
            requestWithValidatedRedirects,
        }));
        jest.doMock('node:fs', () => ({
            ...jest.requireActual('node:fs'),
            createWriteStream: jest.fn(() => new PassThrough()),
            existsSync: jest.fn((filePath: string) =>
                filePath.endsWith('.part')
            ),
        }));
        jest.doMock('node:fs/promises', () => ({
            copyFile: jest.fn(async () => undefined),
            link,
            stat: jest.fn(async () => ({ size: 4 })),
            unlink,
        }));
        jest.doMock('./download-file-path', () => ({
            getPartialDownloadPath: (filePath: string) => `${filePath}.part`,
            getPartialDownloadSize: jest.fn(() => 4),
            removePartialDownloadFile: jest.fn(),
            reserveAvailablePartialDownloadFile: jest.fn(),
        }));

        const runtime = await import('./download-runtime');
        runtime.setMainWindow({
            isDestroyed: () => false,
            webContents: { send: jest.fn() },
        } as never);

        runtime.enqueueDownload({
            ...createTask(),
            filePath: '/downloads/movie.mp4',
            totalBytes: 4,
        });
        await waitForStatus(set, 'completed');

        expect(requestWithValidatedRedirects).not.toHaveBeenCalled();
        expect(link).toHaveBeenCalledWith(
            '/downloads/movie.mp4.part',
            '/downloads/movie.mp4'
        );
        expect(unlink).toHaveBeenCalledWith('/downloads/movie.mp4.part');
        expect(set).toHaveBeenCalledWith(
            expect.objectContaining({
                bytesDownloaded: 4,
                filePath: '/downloads/movie.mp4',
                status: 'completed',
                totalBytes: 4,
            })
        );
    });

    it('finalizes a retained completed partial beside an occupied destination without touching it', async () => {
        jest.resetModules();

        const set = jest.fn(() => ({ where: jest.fn().mockResolvedValue(undefined) }));
        const db = {
            update: jest.fn(() => ({ set })),
        };
        const requestWithValidatedRedirects = jest.fn();
        const link = jest.fn(async () => undefined);
        const unlink = jest.fn(async () => undefined);
        const occupied = new Set([
            '/downloads/movie.mp4',
            '/downloads/movie.mp4.part',
        ]);
        const rename = jest.fn(async (from: string, to: string) => {
            occupied.delete(from);
            occupied.add(to);
        });

        jest.doMock('../../database/connection', () => ({
            getDatabase: jest.fn().mockResolvedValue(db),
        }));
        jest.doMock('../../util/validated-axios', () => ({
            requestWithValidatedRedirects,
        }));
        jest.doMock('node:fs', () => ({
            ...jest.requireActual('node:fs'),
            createWriteStream: jest.fn(() => new PassThrough()),
            existsSync: jest.fn((filePath: string) => occupied.has(filePath)),
        }));
        jest.doMock('node:fs/promises', () => ({
            copyFile: jest.fn(async () => undefined),
            link,
            rename,
            stat: jest.fn(async () => ({ size: 4 })),
            unlink,
        }));
        jest.doMock('./download-file-path', () => ({
            findAvailableFinalPath: jest.fn(() => ({
                filename: 'movie (1).mp4',
                path: '/downloads/movie (1).mp4',
            })),
            getPartialDownloadPath: (filePath: string) => `${filePath}.part`,
            getPartialDownloadSize: jest.fn(() => 4),
            removePartialDownloadFile: jest.fn(),
            reserveAvailablePartialDownloadFile: jest.fn(),
        }));

        const runtime = await import('./download-runtime');
        runtime.setMainWindow({
            isDestroyed: () => false,
            webContents: { send: jest.fn() },
        } as never);

        runtime.enqueueDownload({
            ...createTask(),
            filePath: '/downloads/movie.mp4',
            totalBytes: 4,
        });
        await waitForStatus(set, 'completed');

        // The occupied destination is never unlinked or overwritten; the
        // retained partial moves aside and finalizes under a numbered name.
        expect(requestWithValidatedRedirects).not.toHaveBeenCalled();
        expect(unlink).not.toHaveBeenCalledWith('/downloads/movie.mp4');
        expect(rename).toHaveBeenCalledWith(
            '/downloads/movie.mp4.part',
            '/downloads/movie (1).mp4.part'
        );
        expect(link).toHaveBeenCalledWith(
            '/downloads/movie (1).mp4.part',
            '/downloads/movie (1).mp4'
        );
        expect(set).toHaveBeenCalledWith(
            expect.objectContaining({
                bytesDownloaded: 4,
                fileName: 'movie (1).mp4',
                filePath: '/downloads/movie (1).mp4',
                status: 'completed',
                totalBytes: 4,
            })
        );
    });
});
