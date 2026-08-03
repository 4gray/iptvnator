import {
    createPartialDownloadCleanup,
    removePartialDownloadFileAsync,
} from './download-partial-cleanup';

describe('bounded partial download cleanup', () => {
    it.each([
        ['EACCES', 'unknown'],
        ['EIO', 'unknown'],
        ['ENOENT', 'missing'],
        ['ENOTDIR', 'missing'],
    ] as const)(
        'classifies an %s unlink result as %s',
        async (code, expected) => {
            const error = Object.assign(new Error(code), { code });
            const unlink = jest.fn(async () => {
                throw error;
            });
            const cleanup = createPartialDownloadCleanup(unlink);

            await expect(
                removePartialDownloadFileAsync(
                    '/downloads/episode.mp4',
                    25,
                    cleanup
                )
            ).resolves.toBe(expected);
            expect(unlink).toHaveBeenCalledWith('/downloads/episode.mp4.part');
        }
    );

    it('removes the partial asynchronously', async () => {
        const unlink = jest.fn(async () => undefined);
        const cleanup = createPartialDownloadCleanup(unlink);

        await expect(
            removePartialDownloadFileAsync(
                '/downloads/episode.mp4',
                25,
                cleanup
            )
        ).resolves.toBe('removed');
        expect(unlink).toHaveBeenCalledWith('/downloads/episode.mp4.part');
    });

    it('waits for a started unlink and coalesces same-path callers', async () => {
        jest.useFakeTimers();
        try {
            let finish: (() => void) | undefined;
            const unlink = jest.fn(
                () =>
                    new Promise<void>((resolve) => {
                        finish = resolve;
                    })
            );
            const cleanup = createPartialDownloadCleanup(unlink, 1);
            const first = removePartialDownloadFileAsync(
                '/downloads/episode.mp4',
                25,
                cleanup
            );
            const second = removePartialDownloadFileAsync(
                '/downloads/episode.mp4',
                50,
                cleanup
            );
            let firstSettled = false;
            void first.then(() => {
                firstSettled = true;
            });

            await jest.advanceTimersByTimeAsync(25);
            expect(firstSettled).toBe(false);
            expect(unlink).toHaveBeenCalledTimes(1);

            finish?.();
            await expect(first).resolves.toBe('removed');
            await expect(second).resolves.toBe('removed');
            expect(unlink).toHaveBeenCalledTimes(1);
        } finally {
            jest.useRealTimers();
        }
    });

    it('times out queued cleanup without unlinking it later', async () => {
        jest.useFakeTimers();
        try {
            let finishFirst: (() => void) | undefined;
            const unlink = jest.fn((partialPath: string) =>
                partialPath.includes('first')
                    ? new Promise<void>((resolve) => {
                          finishFirst = resolve;
                      })
                    : Promise.resolve()
            );
            const cleanup = createPartialDownloadCleanup(unlink, 1);
            const first = removePartialDownloadFileAsync(
                '/downloads/first.mp4',
                25,
                cleanup
            );
            const queued = removePartialDownloadFileAsync(
                '/downloads/queued.mp4',
                25,
                cleanup
            );

            await jest.advanceTimersByTimeAsync(25);
            await expect(queued).resolves.toBe('unknown');
            expect(unlink).toHaveBeenCalledTimes(1);

            finishFirst?.();
            await expect(first).resolves.toBe('removed');
            await Promise.resolve();
            expect(unlink).toHaveBeenCalledTimes(1);
        } finally {
            jest.useRealTimers();
        }
    });
});
