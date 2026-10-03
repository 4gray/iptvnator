import type { EmbeddedMpvSupport } from './embedded-mpv-session.interface';
import {
    EMBEDDED_MPV_SUPPORT_RECHECK_MAX_MS,
    EMBEDDED_MPV_SUPPORT_RECHECK_MS,
    watchEmbeddedMpvSupport,
} from './embedded-mpv-support-watch.util';

const SUPPORTED: EmbeddedMpvSupport = { supported: true, platform: 'linux' };
const UNSUPPORTED: EmbeddedMpvSupport = {
    supported: false,
    platform: 'linux',
    reason: 'no mpv',
};
const INCONCLUSIVE: EmbeddedMpvSupport = { ...UNSUPPORTED, inconclusive: true };

describe('watchEmbeddedMpvSupport', () => {
    let onAnswer: jest.Mock;
    let onError: jest.Mock;

    beforeEach(() => {
        jest.useFakeTimers();
        onAnswer = jest.fn();
        onError = jest.fn();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it.each([SUPPORTED, UNSUPPORTED])(
        'delivers a final answer once and asks no more: %j',
        async (answer) => {
            const getSupport = jest.fn().mockResolvedValue(answer);

            watchEmbeddedMpvSupport(getSupport, onAnswer, onError);
            await jest.advanceTimersByTimeAsync(
                EMBEDDED_MPV_SUPPORT_RECHECK_MS * 3
            );

            expect(getSupport).toHaveBeenCalledTimes(1);
            expect(onAnswer.mock.calls).toEqual([[answer]]);
            expect(onError).not.toHaveBeenCalled();
        }
    );

    it('asks again while the answer is inconclusive, until a final one', async () => {
        const getSupport = jest
            .fn()
            .mockResolvedValueOnce(INCONCLUSIVE)
            .mockResolvedValueOnce(INCONCLUSIVE)
            .mockResolvedValue(SUPPORTED);

        watchEmbeddedMpvSupport(getSupport, onAnswer, onError);
        await jest.advanceTimersByTimeAsync(0);
        expect(getSupport).toHaveBeenCalledTimes(1);
        expect(onAnswer).toHaveBeenLastCalledWith(INCONCLUSIVE);

        await jest.advanceTimersByTimeAsync(EMBEDDED_MPV_SUPPORT_RECHECK_MS);
        expect(getSupport).toHaveBeenCalledTimes(2);
        expect(onAnswer).toHaveBeenLastCalledWith(INCONCLUSIVE);

        await jest.advanceTimersByTimeAsync(
            EMBEDDED_MPV_SUPPORT_RECHECK_MS * 2
        );
        expect(getSupport).toHaveBeenCalledTimes(3);
        expect(onAnswer).toHaveBeenLastCalledWith(SUPPORTED);

        await jest.advanceTimersByTimeAsync(
            EMBEDDED_MPV_SUPPORT_RECHECK_MAX_MS * 3
        );
        expect(getSupport).toHaveBeenCalledTimes(3);
    });

    it('backs off to the slowest rate while the answer stays inconclusive', async () => {
        const getSupport = jest.fn().mockResolvedValue(INCONCLUSIVE);

        watchEmbeddedMpvSupport(getSupport, onAnswer, onError);
        // Rechecks after 3, 6, 12 and 24 s, then every 30 s.
        await jest.advanceTimersByTimeAsync(3000 + 6000 + 12_000 + 24_000);
        expect(getSupport).toHaveBeenCalledTimes(5);

        await jest.advanceTimersByTimeAsync(
            EMBEDDED_MPV_SUPPORT_RECHECK_MAX_MS - 1
        );
        expect(getSupport).toHaveBeenCalledTimes(5);
        await jest.advanceTimersByTimeAsync(1);
        expect(getSupport).toHaveBeenCalledTimes(6);
        await jest.advanceTimersByTimeAsync(
            EMBEDDED_MPV_SUPPORT_RECHECK_MAX_MS
        );
        expect(getSupport).toHaveBeenCalledTimes(7);
    });

    it('asks no more when the answer handler stops the watch', async () => {
        const getSupport = jest.fn().mockResolvedValue(INCONCLUSIVE);
        const stop: () => void = watchEmbeddedMpvSupport(
            getSupport,
            () => stop(),
            onError
        );

        await jest.advanceTimersByTimeAsync(
            EMBEDDED_MPV_SUPPORT_RECHECK_MAX_MS * 3
        );

        expect(getSupport).toHaveBeenCalledTimes(1);
    });

    it('asks no more once stopped', async () => {
        const getSupport = jest.fn().mockResolvedValue(INCONCLUSIVE);

        const stop = watchEmbeddedMpvSupport(getSupport, onAnswer, onError);
        await jest.advanceTimersByTimeAsync(0);
        stop();
        await jest.advanceTimersByTimeAsync(
            EMBEDDED_MPV_SUPPORT_RECHECK_MAX_MS * 3
        );

        expect(getSupport).toHaveBeenCalledTimes(1);
        expect(onAnswer).toHaveBeenCalledTimes(1);
    });

    it('drops an answer that arrives after it was stopped', async () => {
        let answer: (support: EmbeddedMpvSupport) => void = () => undefined;
        const getSupport = jest.fn(
            () =>
                new Promise<EmbeddedMpvSupport>((resolve) => {
                    answer = resolve;
                })
        );

        const stop = watchEmbeddedMpvSupport(getSupport, onAnswer, onError);
        stop();
        answer(INCONCLUSIVE);
        await jest.advanceTimersByTimeAsync(
            EMBEDDED_MPV_SUPPORT_RECHECK_MAX_MS * 3
        );

        expect(onAnswer).not.toHaveBeenCalled();
        expect(getSupport).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['rejects', () => Promise.reject(new Error('bridge failed'))],
        [
            'throws',
            () => {
                throw new Error('bridge failed');
            },
        ],
    ])(
        'ends the watch with the error when the request %s',
        async (_how, request) => {
            const getSupport = jest.fn(request);

            watchEmbeddedMpvSupport(getSupport, onAnswer, onError);
            await jest.advanceTimersByTimeAsync(
                EMBEDDED_MPV_SUPPORT_RECHECK_MS * 3
            );

            expect(onError).toHaveBeenCalledTimes(1);
            expect(onError.mock.calls[0][0]).toEqual(
                new Error('bridge failed')
            );
            expect(onAnswer).not.toHaveBeenCalled();
            expect(getSupport).toHaveBeenCalledTimes(1);
        }
    );
});
