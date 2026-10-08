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
    startPending: false,
    watchBatchRunning: false,
    sourcesCount: 0,
    externalPlayerHint: 'MPV' as const,
    copyUrlEpisodeCode: null,
    downloadVisible: false,
    downloadCount: 0,
    downloadDisabled: false,
    downloadBusy: false,
    categoryName: null,
    inContinueWatching: false,
};

function row(input: Partial<typeof BASE>, id: string) {
    return buildSeriesMenuSections({ ...BASE, ...input })
        .flatMap((section) => section.items)
        .find((item) => item.id === id);
}

function resetRow(input: Partial<typeof BASE>) {
    return row(input, SERIES_MENU_ACTION.ResetProgress);
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

    it('disables the progress reset while a watched batch persists', () => {
        // The hosts refuse the reset request meanwhile; an enabled row
        // would close the menu and do nothing.
        expect(resetRow({ watchBatchRunning: true })?.disabled).toBe(true);
    });

    it('hides the reset once every episode is watched', () => {
        expect(resetRow({ seriesFullyWatched: true })).toBeUndefined();
    });

    it('holds the external-player row while a start has not settled', () => {
        const external = SERIES_MENU_ACTION.ExternalPlayer;
        expect(row({}, external)?.disabled).toBeFalsy();
        // A second launch could not cancel the first: both players would open.
        expect(row({ startPending: true }, external)?.disabled).toBe(true);
    });
});
