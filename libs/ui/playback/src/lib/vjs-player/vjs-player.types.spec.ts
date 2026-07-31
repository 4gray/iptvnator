import { type VideoJsPlayer, getVideoJsTechVideo } from './vjs-player.types';
import * as playerTypes from './vjs-player.types';

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

describe('hasActiveVhsSourceHandler', () => {
    it('detects the documented Video.js Tech VHS runtime property', () => {
        expect(
            hasActiveVhsSourceHandler({
                tech: () => ({ vhs: {} }),
            } as unknown as VideoJsPlayer)
        ).toBe(true);
        expect(
            hasActiveVhsSourceHandler({
                tech: () => ({ el: () => document.createElement('video') }),
            } as unknown as VideoJsPlayer)
        ).toBe(false);
    });

    it('fails closed when Tech access is transiently unavailable', () => {
        expect(
            hasActiveVhsSourceHandler({
                tech: () => {
                    throw new Error('Tech unavailable');
                },
            } as unknown as VideoJsPlayer)
        ).toBe(false);
    });
});

function hasActiveVhsSourceHandler(player: VideoJsPlayer): boolean {
    const helper = (
        playerTypes as unknown as {
            readonly hasActiveVhsSourceHandler?: (
                candidate: VideoJsPlayer
            ) => boolean;
        }
    ).hasActiveVhsSourceHandler;

    expect(helper).toBeDefined();
    if (!helper) {
        throw new Error('hasActiveVhsSourceHandler is not exported');
    }
    return helper(player);
}
