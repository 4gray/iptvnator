import {
    DEFAULT_PLAYER_CAPABILITIES,
    createEmptyControlsState,
} from './player-controls-defaults';

describe('player-controls defaults', () => {
    it('defaults Picture-in-Picture to unsupported and inactive', () => {
        expect(DEFAULT_PLAYER_CAPABILITIES.pictureInPicture).toBe(false);
        expect(createEmptyControlsState()).toMatchObject({
            pictureInPictureActive: false,
            canPictureInPicture: false,
        });
    });

    it('defaults quality selection to unsupported with auto enabled', () => {
        expect(DEFAULT_PLAYER_CAPABILITIES.qualityLevels).toBe(false);
        expect(createEmptyControlsState()).toMatchObject({
            qualityLevels: [],
            qualityAutoEnabled: true,
        });
    });
});
