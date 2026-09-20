import { EpgItem, EpgProgram } from '@iptvnator/shared/interfaces';
import {
    epgProgramProgressPercent,
    hasEpgProgramEnded,
    pickAiringOrUpcomingEpgItem,
    pickEpgPreviewItem,
    toSharedEpgProgram,
} from './epg-preview-program';

function item(title: string, startIso: string, stopIso: string): EpgItem {
    return {
        id: title,
        epg_id: `epg-${title}`,
        title,
        lang: 'en',
        start: startIso,
        end: stopIso,
        stop: stopIso,
        description: '',
        channel_id: 'channel-1',
        start_timestamp: String(Math.floor(Date.parse(startIso) / 1000)),
        stop_timestamp: String(Math.floor(Date.parse(stopIso) / 1000)),
    };
}

const at = (iso: string) => Date.parse(iso);

describe('pickAiringOrUpcomingEpgItem', () => {
    const early = item('Early', '2026-04-05T05:30:00Z', '2026-04-05T06:00:00Z');
    const late = item('Late', '2026-04-05T06:00:00Z', '2026-04-05T06:30:00Z');

    it('returns the program on air', () => {
        expect(
            pickAiringOrUpcomingEpgItem(
                [late, early],
                at('2026-04-05T05:45:00Z')
            )
        ).toBe(early);
    });

    it('returns the next program to start when nothing is on air yet', () => {
        expect(
            pickAiringOrUpcomingEpgItem([late], at('2026-04-05T05:45:00Z'))
        ).toBe(late);
    });

    it('returns null once every program has ended', () => {
        // The caller must request fresh data rather than present a finished
        // program as the current one (#767).
        expect(
            pickAiringOrUpcomingEpgItem(
                [early, late],
                at('2026-04-05T07:00:00Z')
            )
        ).toBeNull();
    });

    it('returns null for an empty guide', () => {
        expect(
            pickAiringOrUpcomingEpgItem([], at('2026-04-05T07:00:00Z'))
        ).toBeNull();
    });

    it('hands the boundary instant to the program that starts on it', () => {
        // A program occupies [start, stop), the same rule hasEpgProgramEnded
        // applies -- otherwise the two disagree at the boundary and the row
        // re-applies the finished program for another minute.
        expect(
            pickAiringOrUpcomingEpgItem(
                [early, late],
                at('2026-04-05T06:00:00Z')
            )
        ).toBe(late);
    });
});

describe('pickEpgPreviewItem', () => {
    it('falls back to the earliest item so a first paint is never blank', () => {
        const early = item(
            'Early',
            '2026-04-05T05:00:00Z',
            '2026-04-05T05:30:00Z'
        );
        const late = item(
            'Late',
            '2026-04-05T05:30:00Z',
            '2026-04-05T06:00:00Z'
        );

        expect(
            pickEpgPreviewItem([late, early], at('2026-04-05T07:00:00Z'))
        ).toBe(early);
    });
});

describe('hasEpgProgramEnded', () => {
    const shown = toSharedEpgProgram(
        item('Show', '2026-04-05T05:30:00Z', '2026-04-05T06:00:00Z')
    );

    it('is false while the program runs and true at its stop time', () => {
        expect(hasEpgProgramEnded(shown, at('2026-04-05T05:59:00Z'))).toBe(
            false
        );
        expect(hasEpgProgramEnded(shown, at('2026-04-05T06:00:00Z'))).toBe(
            true
        );
    });

    it('keeps a program with an unreadable end time on screen', () => {
        // Answering "ended" would re-request this row once a minute forever.
        const broken: EpgProgram = {
            ...shown,
            stop: 'not-a-date',
            stopTimestamp: null,
        };

        expect(hasEpgProgramEnded(broken, at('2026-04-05T09:00:00Z'))).toBe(
            false
        );
    });
});

describe('epgProgramProgressPercent', () => {
    const shown = toSharedEpgProgram(
        item('Show', '2026-04-05T05:00:00Z', '2026-04-05T07:00:00Z')
    );

    it('reports the elapsed share of the running program', () => {
        expect(
            epgProgramProgressPercent(shown, at('2026-04-05T06:00:00Z'))
        ).toBeCloseTo(50, 5);
    });

    it('reports nothing outside the program', () => {
        expect(
            epgProgramProgressPercent(shown, at('2026-04-05T04:00:00Z'))
        ).toBeNull();
        expect(
            epgProgramProgressPercent(shown, at('2026-04-05T08:00:00Z'))
        ).toBeNull();
    });

    it('reports nothing for a zero-length program', () => {
        const instant = toSharedEpgProgram(
            item('Instant', '2026-04-05T06:00:00Z', '2026-04-05T06:00:00Z')
        );

        expect(
            epgProgramProgressPercent(instant, at('2026-04-05T06:00:00Z'))
        ).toBeNull();
    });
});
