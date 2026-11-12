import { EpgProgram } from '@iptvnator/shared/interfaces';
import { NEVER, of } from 'rxjs';
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

function harness(
    offsetMinutes = 0,
    isChannelVisible?: (epgKey: string) => boolean
): Harness {
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
        isChannelVisible,
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
            }),
            expect.any(AbortSignal)
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
            }),
            expect.any(AbortSignal)
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
            }),
            expect.any(AbortSignal)
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
            expect.objectContaining({ channelName: 'Channel b' }),
            expect.any(AbortSignal)
        );

        test.focusRow.mockClear();
        test.open.mockClear();
        test.controller.openSearchResult({
            channelId: null,
            program: program({ channel: 'x' }),
        });

        expect(test.focusRow).not.toHaveBeenCalled();
        expect(test.open).toHaveBeenCalledWith(
            expect.not.objectContaining({ channelName: expect.anything() }),
            expect.any(AbortSignal)
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

    it('keeps the original search label if the displayed row is another copy', () => {
        const test = harness();
        test.controller.openSearchResult({
            channelId: 'b',
            channelEpgKey: 'synthetic-other-copy',
            channelName: 'Synthetic Other Copy',
            program: program(),
        });
        expect(test.focusRow).not.toHaveBeenCalled();
        expect(test.open).toHaveBeenCalledWith(
            expect.objectContaining({ channelName: 'Synthetic Other Copy' }),
            expect.any(AbortSignal)
        );
    });

    it('dismisses an off-scope search hit when its channel becomes unavailable', () => {
        let allowed = true;
        const test = harness(
            0,
            (key) => key === 'synthetic-other-copy' && allowed
        );
        test.open.mockReturnValue(NEVER);
        const hit = {
            channelId: 'b',
            channelEpgKey: 'synthetic-other-copy',
            channelName: 'Synthetic Other Copy',
            program: program(),
        };
        test.controller.openSearchResult(hit);
        const owner: AbortSignal = test.open.mock.calls[0][1];
        test.controller.checkVisibility();
        expect(owner.aborted).toBe(false);
        allowed = false;
        test.controller.checkVisibility();
        expect(owner.aborted).toBe(true);
        test.controller.openSearchResult(hit);
        expect(test.open).toHaveBeenCalledTimes(1);
    });
});
