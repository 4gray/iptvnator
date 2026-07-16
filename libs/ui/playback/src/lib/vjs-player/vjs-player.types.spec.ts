import { type VideoJsPlayer, getVideoJsTechVideo } from './vjs-player.types';

describe('getVideoJsTechVideo', () => {
    it('returns the current Video.js Tech video element', () => {
        const video = document.createElement('video');
        const tech = jest.fn(() => ({ el: () => video }));

        expect(getVideoJsTechVideo({ tech } as unknown as VideoJsPlayer)).toBe(
            video
        );
        expect(tech).toHaveBeenCalledWith({
            IWillNotUseThisInPlugins: true,
        });
    });

    it('rejects non-video Tech elements and transient access failures', () => {
        expect(
            getVideoJsTechVideo({
                tech: () => ({ el: () => document.createElement('div') }),
            } as unknown as VideoJsPlayer)
        ).toBeNull();
        expect(
            getVideoJsTechVideo({
                tech: () => {
                    throw new Error('Tech unavailable');
                },
            } as unknown as VideoJsPlayer)
        ).toBeNull();
    });
});
