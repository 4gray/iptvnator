import { copyTextToClipboard } from './clipboard-copy.util';

describe('copyTextToClipboard', () => {
    const originalClipboard = navigator.clipboard;
    const originalExecCommand = Object.getOwnPropertyDescriptor(
        document,
        'execCommand'
    );
    const execCommand = jest.fn<boolean, [string]>();

    beforeEach(() => {
        execCommand.mockReset();
        Object.defineProperty(document, 'execCommand', {
            configurable: true,
            value: execCommand,
        });
    });

    afterEach(() => {
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: originalClipboard,
        });
        if (originalExecCommand) {
            Object.defineProperty(document, 'execCommand', originalExecCommand);
        } else {
            Reflect.deleteProperty(document, 'execCommand');
        }
    });

    it('resolves without a fallback when the Clipboard API succeeds', async () => {
        const writeText = jest.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { writeText },
        });
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
        execCommand.mockReturnValue(true);

        await expect(
            copyTextToClipboard('https://example.test/stream.m3u8')
        ).resolves.toBeUndefined();
        expect(execCommand).toHaveBeenCalledWith('copy');
    });

    it('removes the temporary textarea after a successful fallback', async () => {
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: {
                writeText: jest.fn().mockRejectedValue(new Error('nope')),
            },
        });
        execCommand.mockReturnValue(true);

        await copyTextToClipboard('https://example.test/stream.m3u8');

        expect(document.querySelectorAll('textarea')).toHaveLength(0);
    });

    it('restores the focused control after the fallback moves focus', async () => {
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: {
                writeText: jest.fn().mockRejectedValue(new Error('nope')),
            },
        });
        execCommand.mockImplementation(() => {
            const textarea = document.querySelector('textarea');
            textarea?.focus();
            expect(document.activeElement).toBe(textarea);
            return true;
        });
        const button = document.createElement('button');
        document.body.append(button);
        button.focus();

        try {
            await copyTextToClipboard('https://example.test/stream.m3u8');
            expect(document.activeElement).toBe(button);
        } finally {
            button.remove();
        }
    });

    it('throws the original error when both the API and the fallback fail', async () => {
        const originalError = new Error('Document is not focused');
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: {
                writeText: jest.fn().mockRejectedValue(originalError),
            },
        });
        execCommand.mockReturnValue(false);

        await expect(
            copyTextToClipboard('https://example.test/stream.m3u8')
        ).rejects.toBe(originalError);
    });
});
