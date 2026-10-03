import {
    buildSeriesMenuSections,
    SERIES_MENU_ACTION,
} from './series-hero.state';

const BASE = {
    seasonWatchVisible: false,
    seasonFullyWatched: false,
    seasonEligibleCount: 0,
    seasonActionDisabled: false,
    seriesMenuVisible: true,
    seriesFullyWatched: false,
    seriesEligibleCount: 3,
    seriesCountKnown: true,
    seriesActionDisabled: false,
    hasProgress: true,
    playbackActive: false,
    sourcesCount: 0,
    externalPlayerHint: null,
    copyUrlEpisodeCode: null,
    downloadVisible: false,
    downloadCount: 0,
    downloadDisabled: false,
    downloadBusy: false,
    categoryName: null,
    inContinueWatching: false,
};

function resetRow(input: Partial<typeof BASE>) {
    return buildSeriesMenuSections({ ...BASE, ...input })
        .flatMap((section) => section.items)
        .find((row) => row.id === SERIES_MENU_ACTION.ResetProgress);
}

describe('buildSeriesMenuSections', () => {
    it('offers the progress reset while nothing plays', () => {
        expect(resetRow({})?.disabled).toBeFalsy();
    });

    it('disables the progress reset while an episode plays or launches', () => {
        // The running player would write the position right back.
        expect(resetRow({ playbackActive: true })?.disabled).toBe(true);
        // Independent of the bulk watched action's own state.
        expect(resetRow({ seriesActionDisabled: true })?.disabled).toBeFalsy();
    });

    it('hides the reset once every episode is watched', () => {
        expect(resetRow({ seriesFullyWatched: true })).toBeUndefined();
    });
});
