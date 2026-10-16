import {
    buildCatchupTimelineSegments,
    type CatchupTimelineProgramme,
} from './catchup-timeline-segments';
import { normalizeTimelineSegments } from './controls-timeline-segments';

const T0 = 1_750_000_000; // epoch seconds

function programme(
    title: string,
    startOffsetMin: number,
    stopOffsetMin: number,
    withTimestamps = true
): CatchupTimelineProgramme {
    const start = T0 + startOffsetMin * 60;
    const stop = T0 + stopOffsetMin * 60;
    return {
        title,
        start: new Date(start * 1000).toISOString(),
        stop: new Date(stop * 1000).toISOString(),
        ...(withTimestamps
            ? { startTimestamp: start, stopTimestamp: stop }
            : {}),
    };
}

describe('buildCatchupTimelineSegments', () => {
    const news = programme('News', -30, 0);
    const film = programme('Film', 0, 90);
    const late = programme('Late show', 90, 150);
    const guide = [late, news, film];

    it('returns null for live playback or an unusable window', () => {
        expect(buildCatchupTimelineSegments(guide, null)).toBeNull();
        expect(
            buildCatchupTimelineSegments(guide, {
                title: 'Broken',
                start: 'not a date',
                stop: 'not a date',
            })
        ).toBeNull();
        expect(
            buildCatchupTimelineSegments(guide, programme('Reversed', 10, 5))
        ).toBeNull();
        expect(buildCatchupTimelineSegments(guide, film, T0)).toBeNull();
    });

    it('bounds the window to the programme for Xtream timeshift', () => {
        expect(buildCatchupTimelineSegments(guide, film)).toEqual([
            { startSeconds: 0, endSeconds: 5400, title: 'Film' },
        ]);
    });

    it('lists every overlapping programme of an open window, in order', () => {
        const segments = buildCatchupTimelineSegments(
            guide,
            film,
            T0 + 120 * 60
        );

        expect(segments).toEqual([
            { startSeconds: 0, endSeconds: 5400, title: 'Film' },
            { startSeconds: 5400, endSeconds: 7200, title: 'Late show' },
        ]);
    });

    it('clips programmes that straddle the window end', () => {
        const segments = buildCatchupTimelineSegments(
            [programme('Picked', 0, 30), programme('Long film', 30, 200)],
            programme('Picked', 0, 30),
            T0 + 60 * 60
        );

        expect(segments).toEqual([
            { startSeconds: 0, endSeconds: 1800, title: 'Picked' },
            { startSeconds: 1800, endSeconds: 3600, title: 'Long film' },
        ]);
    });

    it('keeps the picked title over overlapping or revised guide entries', () => {
        const segments = buildCatchupTimelineSegments(
            [
                programme('Early', -10, 20),
                programme('Revised Picked', 5, 30),
                programme('Mid', 20, 40),
            ],
            programme('Picked', 5, 30),
            T0 + 40 * 60
        );

        expect(segments).toEqual([
            { startSeconds: 0, endSeconds: 1500, title: 'Picked' },
            { startSeconds: 1500, endSeconds: 2100, title: 'Mid' },
        ]);
    });

    it('falls back to the ISO strings when timestamps are missing', () => {
        const isoFilm = programme('Film', 0, 90, false);
        expect(
            buildCatchupTimelineSegments(
                [isoFilm, programme('Late show', 90, 150, false)],
                isoFilm,
                T0 + 100 * 60
            )
        ).toEqual([
            { startSeconds: 0, endSeconds: 5400, title: 'Film' },
            { startSeconds: 5400, endSeconds: 6000, title: 'Late show' },
        ]);
    });

    it('keeps the activated programme when the list does not hold it', () => {
        expect(buildCatchupTimelineSegments([], film)).toEqual([
            { startSeconds: 0, endSeconds: 5400, title: 'Film' },
        ]);
        expect(buildCatchupTimelineSegments(null, film)).toEqual([
            { startSeconds: 0, endSeconds: 5400, title: 'Film' },
        ]);
    });

    it('turns blank titles into untitled segments', () => {
        const blank = programme('  ', 0, 30);
        expect(buildCatchupTimelineSegments([blank], blank)).toEqual([
            { startSeconds: 0, endSeconds: 1800, title: null },
        ]);
    });

    it('feeds the controls a cover of the real stream duration', () => {
        const segments = buildCatchupTimelineSegments(
            guide,
            film,
            T0 + 120 * 60
        );

        // The provider served 100 minutes: the tail programme is clamped.
        expect(
            normalizeTimelineSegments(segments, 6000).map((segment) => [
                segment.title,
                segment.startSeconds,
                segment.endSeconds,
            ])
        ).toEqual([
            ['Film', 0, 5400],
            ['Late show', 5400, 6000],
        ]);
    });
});
