import {
    buildVodMenuSections,
    formatPlaybackClock,
    VOD_DETAILS_MENU_ACTION,
} from './vod-details-presentation';

describe('formatPlaybackClock', () => {
    it('formats a resume point as a clock', () => {
        expect(formatPlaybackClock(754)).toBe('12:34');
        expect(formatPlaybackClock(5025)).toBe('1:23:45');
        expect(formatPlaybackClock(65)).toBe('1:05');
        expect(formatPlaybackClock(0)).toBe('');
        expect(formatPlaybackClock(null)).toBe('');
    });
});

const BASE = {
    externalPlayerAvailable: true,
    externalPlayerHint: 'MPV' as const,
    hasPlaybackPosition: true,
    hasStoredProgress: true,
    playbackActive: false,
    startPending: false,
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

    it('disables Start Over while a start still resolves', () => {
        const restart = rows({ startPending: true }).find(
            (row) => row.id === VOD_DETAILS_MENU_ACTION.StartOver
        );
        expect(restart?.disabled).toBe(true);
    });

    it('disables the external launch while a start still resolves', () => {
        const external = rows({ startPending: true }).find(
            (row) => row.id === VOD_DETAILS_MENU_ACTION.ExternalPlayer
        );
        expect(external?.disabled).toBe(true);
        expect(
            rows({}).find(
                (row) => row.id === VOD_DETAILS_MENU_ACTION.ExternalPlayer
            )?.disabled
        ).toBeFalsy();
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
