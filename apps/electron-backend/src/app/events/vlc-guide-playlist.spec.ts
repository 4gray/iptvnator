jest.mock('../util/validated-axios', () => ({
    requestWithValidatedRedirects: jest.fn(),
}));

import { requestWithValidatedRedirects } from '../util/validated-axios';
import { XTREAM_CLIENT_USER_AGENT } from '@iptvnator/shared/interfaces';
import { matchesVlcInput, matchVlcGuidePlaylist } from './vlc-guide-playlist';

describe('VLC playlist verification', () => {
    beforeEach(() => jest.resetAllMocks());

    it.each([
        ['/synthetic/child.ts', '/synthetic%2Fchild.ts', false],
        ['/synthetic.ts?x=one&y=two', '/synthetic.ts?x=one%26y=two', false],
        ['/synthetic%2fchild.ts', '/synthetic%2Fchild.ts', true],
        ['/synthetic café.ts', '/synthetic%20caf%C3%A9.ts', true],
        ['/synthetic~child.ts', '/synthetic%7Echild.ts', true],
    ] as const)(
        'matches only equivalent VLC inputs (%s, %s)',
        (input, requested, same) => {
            expect(
                matchesVlcInput(
                    `https://example.test${input}`,
                    `https://example.test${requested}`
                )
            ).toBe(same);
        }
    );

    it('gives up confirming a playlist when validation has not returned by the deadline', async () => {
        const deadline = new AbortController();
        const timeout = jest
            .spyOn(AbortSignal, 'timeout')
            .mockReturnValueOnce(deadline.signal);
        jest.mocked(requestWithValidatedRedirects).mockReturnValueOnce(
            new Promise(() => undefined)
        );
        try {
            const matches = matchVlcGuidePlaylist(
                'https://example.test/synthetic.m3u',
                { mergedHeaders: {} }
            );
            const checking = matches('https://example.test/synthetic-child.ts');
            deadline.abort();
            await expect(checking).resolves.toBe(false);
        } finally {
            timeout.mockRestore();
        }
    });

    it('retries a failed playlist fetch after a pause and caches the successful read', async () => {
        jest.useFakeTimers();
        const url = 'https://example.test/synthetic.m3u';
        const childUrl = 'https://example.test/synthetic-child.ts';
        (requestWithValidatedRedirects as jest.Mock)
            .mockRejectedValueOnce(new Error('Synthetic temporary failure'))
            .mockResolvedValueOnce({ config: { url } })
            .mockResolvedValueOnce({
                config: { url },
                data: 'synthetic-child.ts\n',
            });
        const origin = 'https://example.test';
        const matches = matchVlcGuidePlaylist(url, {
            mergedHeaders: {},
            effectiveOrigin: origin,
        });
        await expect(matches(childUrl)).resolves.toBe(false);
        jest.advanceTimersByTime(4_999);
        await expect(matches(childUrl)).resolves.toBe(false);
        expect(requestWithValidatedRedirects).toHaveBeenCalledTimes(1);
        jest.advanceTimersByTime(1);
        await expect(matches(childUrl)).resolves.toBe(true);
        await expect(matches(childUrl)).resolves.toBe(true);
        expect(requestWithValidatedRedirects).toHaveBeenCalledTimes(3);
        expect(requestWithValidatedRedirects).toHaveBeenLastCalledWith(
            url,
            expect.objectContaining({
                headers: {
                    Origin: origin,
                    Referer: origin,
                    'User-Agent': XTREAM_CLIENT_USER_AGENT,
                },
            }),
            expect.anything(),
            0
        );
        jest.useRealTimers();
    });

    it('accepts a headerless playlist identified by its media type but excludes HLS', async () => {
        const url = 'https://example.test/synthetic-input';
        const childUrl = 'https://example.test/synthetic-child.ts';
        const response = {
            config: { url },
            headers: { 'content-type': 'audio/x-mpegurl; charset=utf-8' },
        };
        (requestWithValidatedRedirects as jest.Mock)
            .mockResolvedValueOnce(response)
            .mockResolvedValueOnce({
                ...response,
                data: 'synthetic-child.ts\n',
            })
            .mockResolvedValueOnce(response)
            .mockResolvedValueOnce({
                ...response,
                data: '#EXTM3U\n#EXT-X-TARGETDURATION:1\nsynthetic-child.ts\n',
            });
        const load = () =>
            matchVlcGuidePlaylist(url, { mergedHeaders: {} })(childUrl);
        await expect(load()).resolves.toBe(true);
        await expect(load()).resolves.toBe(false);
        expect(
            jest
                .mocked(requestWithValidatedRedirects)
                .mock.calls.map(([, config]) => config?.method)
        ).toEqual(['HEAD', 'GET', 'HEAD', 'GET']);
    });

    it('refreshes a plain playlist when the resumed child changes, without repeated reads in the cooldown', async () => {
        jest.useFakeTimers();
        try {
            const url = 'https://example.test/synthetic.m3u';
            const first = 'synthetic-first.ts';
            const resumed = 'synthetic-resumed.ts';
            const head = { config: { url } };
            (requestWithValidatedRedirects as jest.Mock)
                .mockResolvedValueOnce(head)
                .mockResolvedValueOnce({ ...head, data: first })
                .mockResolvedValueOnce(head)
                .mockResolvedValueOnce({ ...head, data: resumed });
            const matches = matchVlcGuidePlaylist(url, { mergedHeaders: {} });
            await expect(matches(new URL(first, url).href)).resolves.toBe(true);
            const target = new URL(resumed, url).href;
            jest.advanceTimersByTime(4_999);
            await expect(matches(target)).resolves.toBe(false);
            expect(requestWithValidatedRedirects).toHaveBeenCalledTimes(2);
            jest.advanceTimersByTime(1);
            await expect(
                Promise.all([matches(target), matches(target)])
            ).resolves.toEqual([true, true]);
            expect(requestWithValidatedRedirects).toHaveBeenCalledTimes(4);
            await expect(matches(target)).resolves.toBe(true);
            expect(requestWithValidatedRedirects).toHaveBeenCalledTimes(4);
        } finally {
            jest.useRealTimers();
        }
    });

    it('never opens a media response to check a mismatched input', async () => {
        const direct = 'https://example.test/synthetic.ts';
        const opaque = 'https://example.test/synthetic-input';
        const child = 'https://example.test/synthetic-other.ts';
        await expect(
            matchVlcGuidePlaylist(direct, { mergedHeaders: {} })(child)
        ).resolves.toBe(false);
        expect(requestWithValidatedRedirects).not.toHaveBeenCalled();
        (requestWithValidatedRedirects as jest.Mock).mockResolvedValue({
            config: { url: opaque },
            headers: { 'content-type': 'video/mp2t' },
        });
        await expect(
            matchVlcGuidePlaylist(opaque, { mergedHeaders: {} })(child)
        ).resolves.toBe(false);
        expect(requestWithValidatedRedirects).toHaveBeenCalledTimes(1);
        expect(requestWithValidatedRedirects).toHaveBeenCalledWith(
            opaque,
            expect.objectContaining({ method: 'HEAD' }),
            expect.anything(),
            3
        );
    });
});
