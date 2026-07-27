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
});
