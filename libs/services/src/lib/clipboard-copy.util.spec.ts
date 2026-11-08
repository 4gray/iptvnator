import { copyTextToClipboard } from './clipboard-copy.util';

describe('copyTextToClipboard', () => {
    const originalClipboard = navigator.clipboard;

    afterEach(() => {
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: originalClipboard,
        });
        jest.restoreAllMocks();
    });

    it('resolves without a fallback when the Clipboard API succeeds', async () => {
        const writeText = jest.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { writeText },
        });
        const execCommand = jest.spyOn(document, 'execCommand');

        await copyTextToClipboard('https://example.test/stream.m3u8');

        expect(writeText).toHaveBeenCalledWith(
            'https://example.test/stream.m3u8'
        );
        expect(execCommand).not.toHaveBeenCalled();
    });

    it('falls back to execCommand when the Clipboard API throws', async () => {
        const writeText = jest
            .fn()
            .mockRejectedValue(new Error('Document is not focused'));
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { writeText },
        });
        jest.spyOn(document, 'execCommand').mockReturnValue(true);

        await expect(
            copyTextToClipboard('https://example.test/stream.m3u8')
        ).resolves.toBeUndefined();
    });

    it('removes the temporary textarea after a successful fallback', async () => {
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: {
                writeText: jest.fn().mockRejectedValue(new Error('nope')),
            },
        });
        jest.spyOn(document, 'execCommand').mockReturnValue(true);

        await copyTextToClipboard('https://example.test/stream.m3u8');

        expect(document.querySelectorAll('textarea')).toHaveLength(0);
    });

    it('throws the original error when both the API and the fallback fail', async () => {
        const originalError = new Error('Document is not focused');
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: {
                writeText: jest.fn().mockRejectedValue(originalError),
            },
        });
        jest.spyOn(document, 'execCommand').mockReturnValue(false);

        await expect(
            copyTextToClipboard('https://example.test/stream.m3u8')
        ).rejects.toBe(originalError);
    });
});
