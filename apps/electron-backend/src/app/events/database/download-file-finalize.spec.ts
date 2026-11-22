import { constants } from 'node:fs';
import * as fsp from 'node:fs/promises';
import { finalizePartialDownload } from './download-file-finalize';

jest.mock('node:fs/promises', () => ({
    copyFile: jest.fn(),
    link: jest.fn(),
    stat: jest.fn(),
    unlink: jest.fn(),
}));

const reservation = {
    filename: 'movie.mp4',
    partialPath: '/d/movie.mp4.part',
    path: '/d/movie.mp4',
};

const fsError = (code: string) => Object.assign(new Error(code), { code });

const expectExclusiveCopy = () => {
    expect(fsp.copyFile).toHaveBeenCalledWith(
        reservation.partialPath,
        reservation.path,
        constants.COPYFILE_EXCL
    );
};

describe('finalizePartialDownload', () => {
    beforeEach(() => {
        jest.resetAllMocks();
        jest.mocked(fsp.link).mockResolvedValue(undefined);
        jest.mocked(fsp.copyFile).mockResolvedValue(undefined);
        jest.mocked(fsp.stat).mockResolvedValue({ size: 4 } as never);
        jest.mocked(fsp.unlink).mockResolvedValue(undefined);
    });

    it('uses a hard link when supported and removes the partial', async () => {
        await expect(finalizePartialDownload(reservation, 4)).resolves.toBe(4);
        expect(fsp.link).toHaveBeenCalledWith(
            reservation.partialPath,
            reservation.path
        );
        expect(fsp.copyFile).not.toHaveBeenCalled();
        expect(fsp.unlink).toHaveBeenCalledWith(reservation.partialPath);
    });

    it.each([
        'EACCES',
        'ENOSYS',
        'ENOTSUP',
        'EOPNOTSUPP',
        'EPERM',
        'EXDEV',
        'EISDIR',
        'UNKNOWN',
    ])('copies exclusively when hard links fail with %s', async (code) => {
        jest.mocked(fsp.link).mockRejectedValueOnce(fsError(code));
        await expect(finalizePartialDownload(reservation, 4)).resolves.toBe(4);
        expectExclusiveCopy();
        expect(fsp.unlink).toHaveBeenCalledWith(reservation.partialPath);
    });

    it.each(['EEXIST', 'ENOENT', 'ENOSPC', 'EIO'])(
        'preserves the partial and propagates an unrelated link error: %s',
        async (code) => {
            const error = fsError(code);
            jest.mocked(fsp.link).mockRejectedValueOnce(error);
            await expect(finalizePartialDownload(reservation, 4)).rejects.toBe(
                error
            );
            expect(fsp.copyFile).not.toHaveBeenCalled();
            expect(fsp.unlink).not.toHaveBeenCalled();
        }
    );

    it.each(['EISDIR', 'UNKNOWN'])(
        'preserves a target appearing before the %s copy fallback',
        async (code) => {
            const error = fsError('EEXIST');
            jest.mocked(fsp.link).mockRejectedValueOnce(fsError(code));
            jest.mocked(fsp.copyFile).mockRejectedValueOnce(error);
            await expect(finalizePartialDownload(reservation, 4)).rejects.toBe(
                error
            );
            expectExclusiveCopy();
            expect(fsp.unlink).not.toHaveBeenCalled();
        }
    );

    it('keeps the partial when the fallback copy fails', async () => {
        const error = fsError('ENOSPC');
        jest.mocked(fsp.link).mockRejectedValueOnce(fsError('UNKNOWN'));
        jest.mocked(fsp.copyFile).mockRejectedValueOnce(error);
        await expect(finalizePartialDownload(reservation, 4)).rejects.toBe(
            error
        );
        expect(fsp.unlink).not.toHaveBeenCalled();
    });

    it('accepts the completed output when partial cleanup fails', async () => {
        jest.mocked(fsp.link).mockRejectedValueOnce(fsError('EISDIR'));
        jest.mocked(fsp.unlink).mockRejectedValueOnce(fsError('EACCES'));
        const consoleError = jest
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);
        try {
            await expect(finalizePartialDownload(reservation, 4)).resolves.toBe(
                4
            );
            expectExclusiveCopy();
            expect(consoleError).toHaveBeenCalled();
        } finally {
            consoleError.mockRestore();
        }
    });

    it('propagates cleanup failure when output size does not match', async () => {
        const error = fsError('EACCES');
        jest.mocked(fsp.unlink).mockRejectedValueOnce(error);
        jest.mocked(fsp.stat).mockResolvedValueOnce({ size: 3 } as never);
        await expect(finalizePartialDownload(reservation, 4)).rejects.toBe(
            error
        );
    });
});
