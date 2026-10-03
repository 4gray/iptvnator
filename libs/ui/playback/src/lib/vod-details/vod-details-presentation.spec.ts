import {
    buildVodMenuSections,
    VOD_DETAILS_MENU_ACTION,
} from './vod-details-presentation';

const BASE = {
    externalPlayerAvailable: true,
    externalPlayerHint: 'MPV' as const,
    hasPlaybackPosition: true,
    hasStoredProgress: true,
    playbackActive: false,
};

function rows(input: Partial<typeof BASE>) {
    return buildVodMenuSections({ ...BASE, ...input }).flatMap(
        (section) => section.items
    );
}

describe('buildVodMenuSections', () => {
    it('offers the external player and the progress reset while nothing plays', () => {
        const ids = rows({}).map((row) => row.id);
        expect(ids).toContain(VOD_DETAILS_MENU_ACTION.ExternalPlayer);
        const reset = rows({}).find(
            (row) => row.id === VOD_DETAILS_MENU_ACTION.ResetProgress
        );
        expect(reset?.disabled).toBeFalsy();
    });

    it('disables the progress reset while playback owns the position', () => {
        // A running player, or a start still resolving its stream, would
        // write the position right back.
        const reset = rows({ playbackActive: true }).find(
            (row) => row.id === VOD_DETAILS_MENU_ACTION.ResetProgress
        );
        expect(reset?.disabled).toBe(true);
    });
});
