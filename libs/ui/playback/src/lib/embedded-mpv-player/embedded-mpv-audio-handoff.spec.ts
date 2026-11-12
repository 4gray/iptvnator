import { handoffMpvAudio } from './embedded-mpv-audio-handoff';

describe('two-stream audio handoff', () => {
    it('waits for native mute completion before enabling the other stream', async () => {
        let muted!: () => void;
        const bridge = {
            setEmbeddedMpvVolume: jest
                .fn<ReturnType<Window['electron']['setEmbeddedMpvVolume']>, Parameters<Window['electron']['setEmbeddedMpvVolume']>>()
                .mockImplementationOnce(
                    () =>
                        new Promise((resolve) => {
                            muted = () => resolve(null);
                        })
                )
                .mockResolvedValue(null),
        };
        const pending = handoffMpvAudio(
            bridge,
            'movie',
            'match',
            0.6,
            new AbortController().signal
        );
        expect(bridge.setEmbeddedMpvVolume.mock.calls).toEqual([['movie', 0]]);
        muted();
        await pending;
        expect(bridge.setEmbeddedMpvVolume.mock.calls).toEqual([
            ['movie', 0],
            ['match', 0.6],
        ]);
    });
    it('never unmutes after a mute failure or teardown', async () => {
        const abort = new AbortController();
        const bridge = {
            setEmbeddedMpvVolume: jest
                .fn<ReturnType<Window['electron']['setEmbeddedMpvVolume']>, Parameters<Window['electron']['setEmbeddedMpvVolume']>>()
                .mockRejectedValueOnce(new Error('closed')),
        };
        await expect(
            handoffMpvAudio(bridge, 'movie', 'match', 1, abort.signal)
        ).rejects.toThrow('closed');
        expect(bridge.setEmbeddedMpvVolume).toHaveBeenCalledTimes(1);
        bridge.setEmbeddedMpvVolume.mockImplementationOnce(async () => {
            abort.abort();
            return null;
        });
        await expect(
            handoffMpvAudio(bridge, 'movie', 'match', 1, abort.signal)
        ).rejects.toThrow('cancelled');
        expect(bridge.setEmbeddedMpvVolume).toHaveBeenCalledTimes(2);
    });
});
