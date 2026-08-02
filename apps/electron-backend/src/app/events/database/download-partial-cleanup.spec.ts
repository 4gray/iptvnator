import {
    createPartialDownloadCleanup,
    removePartialDownloadFileWithTimeoutAsync,
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
                removePartialDownloadFileWithTimeoutAsync(
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
            removePartialDownloadFileWithTimeoutAsync(
                '/downloads/episode.mp4',
                25,
                cleanup
            )
        ).resolves.toBe('removed');
        expect(unlink).toHaveBeenCalledWith('/downloads/episode.mp4.part');
    });

    it('bounds each caller while retaining and coalescing the raw cleanup', async () => {
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
            const first = removePartialDownloadFileWithTimeoutAsync(
                '/downloads/episode.mp4',
                25,
                cleanup
            );
            const second = removePartialDownloadFileWithTimeoutAsync(
                '/downloads/episode.mp4',
                50,
                cleanup
            );

            await jest.advanceTimersByTimeAsync(25);
            await expect(first).resolves.toBe('unknown');
            expect(unlink).toHaveBeenCalledTimes(1);

            finish?.();
            await expect(second).resolves.toBe('removed');
            expect(unlink).toHaveBeenCalledTimes(1);
        } finally {
            jest.useRealTimers();
        }
    });
});
