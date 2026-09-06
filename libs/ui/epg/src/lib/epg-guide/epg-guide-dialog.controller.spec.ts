import { EpgProgram } from '@iptvnator/shared/interfaces';
import { of } from 'rxjs';
import { EpgProgrammeDialogService } from '../epg-programme-dialog.service';
import { TimelineRenderBlock } from '../epg-timeline/epg-timeline-render.util';
import {
    EpgGuideDialogController,
    EpgGuideDialogHost,
} from './epg-guide-dialog.controller';
import { EpgGuideCatchUp, EpgGuideChannel } from './epg-guide-source';

const MINUTE_MS = 60_000;
const START_MS = Date.UTC(2026, 0, 15, 20, 0);

const CHANNELS: EpgGuideChannel[] = [
    { id: 'a', number: 1, name: 'Channel a', logoUrl: null, epgKey: 'a' },
    { id: 'b', number: 2, name: 'Channel b', logoUrl: 'logo.png', epgKey: 'b' },
];

function program(overrides: Partial<EpgProgram> = {}): EpgProgram {
    return {
        start: new Date(START_MS).toISOString(),
        stop: new Date(START_MS + 30 * MINUTE_MS).toISOString(),
        channel: 'a',
        title: 'Programme',
        desc: null,
        category: null,
        ...overrides,
    };
}

function block(
    when: 'past' | 'now' | 'future',
    canCatchUp = false
): TimelineRenderBlock {
    return {
        kind: 'block',
        key: 'k',
        block: {
            program: program(),
            key: 'k',
            startMs: START_MS,
            stopMs: START_MS + 30 * MINUTE_MS,
            when,
            offsetMin: 0,
            durationMin: 30,
        },
        leftPx: 0,
        widthPx: 100,
        tier: 'wide',
        nowFillPercent: 0,
        canCatchUp,
    };
}

interface Harness {
    controller: EpgGuideDialogController;
    open: jest.Mock;
    focusRow: jest.Mock;
    activate: jest.Mock;
    watch: jest.Mock;
    offsetMinutes: number;
}

function harness(offsetMinutes = 0): Harness {
    const open = jest.fn(() => of(undefined));
    const focusRow = jest.fn();
    const activate = jest.fn();
    const watch = jest.fn();
    const catchUp: EpgGuideCatchUp = { canWatch: () => true, watch };
    const state = { offsetMinutes };
    const host: EpgGuideDialogHost = {
        rows: () => CHANNELS,
        offsetMinutes: () => state.offsetMinutes,
        focusRow,
        activate,
        catchUp: () => catchUp,
    };
    return {
        controller: new EpgGuideDialogController(
            { open } as unknown as EpgProgrammeDialogService,
            host
        ),
        open,
        focusRow,
        activate,
        watch,
        offsetMinutes,
    };
}

describe('EpgGuideDialogController', () => {
    it('labels a card dialog with its channel and offers the live action', () => {
        const test = harness();
        test.open.mockReturnValueOnce(of('live'));

        test.controller.openDetails(CHANNELS[1], block('now'));

        expect(test.open).toHaveBeenCalledWith(
            expect.objectContaining({
                channelName: 'Channel b',
                channelLogo: 'logo.png',
                primaryAction: 'live',
                archiveUnavailableNote: false,
            })
        );
        expect(test.activate).toHaveBeenCalledWith(CHANNELS[1]);
    });

    it('offers timeshift for a recorded past card and plays it back', () => {
        const test = harness();
        test.open.mockReturnValueOnce(of('timeshift'));
        const item = block('past', true);

        test.controller.openDetails(CHANNELS[0], item);

        expect(test.open).toHaveBeenCalledWith(
            expect.objectContaining({
                primaryAction: 'timeshift',
                archiveUnavailableNote: false,
            })
        );
        expect(test.watch).toHaveBeenCalledWith(
            CHANNELS[0],
            item.block.program
        );
    });

    it('notes a past card that cannot be replayed, and ignores a missing one', () => {
        const test = harness();

        test.controller.openDetails(CHANNELS[0], block('past'));
        expect(test.open).toHaveBeenCalledWith(
            expect.objectContaining({
                primaryAction: null,
                archiveUnavailableNote: true,
            })
        );

        test.open.mockClear();
        test.controller.openDetails(CHANNELS[0], undefined);
        test.controller.openDetails(undefined, block('now'));
        expect(test.open).not.toHaveBeenCalled();
    });

    it('sends a catch-up request straight to the host', () => {
        const test = harness();
        const item = block('past', true);

        test.controller.watch(CHANNELS[0], item);

        expect(test.watch).toHaveBeenCalledWith(
            CHANNELS[0],
            item.block.program
        );
        expect(test.open).not.toHaveBeenCalled();
    });

    it('focuses the row a search hit belongs to, and copes without one', () => {
        const test = harness();

        test.controller.openSearchResult({
            channelId: 'b',
            program: program({ channel: 'b' }),
        });

        expect(test.focusRow).toHaveBeenCalledWith(1);
        expect(test.open).toHaveBeenCalledWith(
            expect.objectContaining({ channelName: 'Channel b' })
        );

        test.focusRow.mockClear();
        test.open.mockClear();
        test.controller.openSearchResult({
            channelId: null,
            program: program({ channel: 'x' }),
        });

        expect(test.focusRow).not.toHaveBeenCalled();
        expect(test.open).toHaveBeenCalledWith(
            expect.not.objectContaining({ channelName: expect.anything() })
        );
    });

    it('shifts a search hit start by the EPG display offset', () => {
        const test = harness(60);

        expect(
            test.controller.searchHitStartMs({
                channelId: 'a',
                program: program(),
            })
        ).toBe(START_MS + 60 * MINUTE_MS);

        // A unix timestamp wins over the ISO string, offset included.
        expect(
            test.controller.searchHitStartMs({
                channelId: 'a',
                program: program({
                    start: 'not a date',
                    startTimestamp: START_MS / 1000,
                }),
            })
        ).toBe(START_MS + 60 * MINUTE_MS);
    });
});
