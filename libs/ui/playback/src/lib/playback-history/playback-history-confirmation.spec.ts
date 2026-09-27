import type { PlaybackHistoryTarget } from '@iptvnator/playback/data-access';
import { PlaybackHistoryConfirmation } from './playback-history-confirmation';

describe('PlaybackHistoryConfirmation', () => {
    const streamA: PlaybackHistoryTarget = {
        sessionKey: 'live:p1:a',
        streamUrls: ['http://stream/a'],
    };
    const streamB: PlaybackHistoryTarget = {
        sessionKey: 'live:p1:b',
        streamUrls: ['http://stream/b'],
    };
    let target: PlaybackHistoryTarget;
    let revision: symbol;
    let confirm: jest.Mock;
    let confirmation: PlaybackHistoryConfirmation;

    const play = (...positions: number[]) =>
        positions.forEach((position) => confirmation.record(position));

    beforeEach(() => {
        target = streamA;
        revision = Symbol('first');
        confirm = jest.fn();
        confirmation = new PlaybackHistoryConfirmation({
            gate: { confirm },
            target: () => target,
            sourceRevision: () => revision,
        });
    });

    it('confirms what played', () => {
        play(0, 1, 2);

        expect(confirm).toHaveBeenCalledWith(streamA);
    });

    it('does not credit a new stream with the previous stream progress', () => {
        play(0, 1.5);
        target = streamB;
        play(0, 0.5);

        expect(confirm).not.toHaveBeenCalled();

        play(1, 2);
        expect(confirm).toHaveBeenCalledTimes(1);
        expect(confirm).toHaveBeenCalledWith(streamB);
    });

    it('confirms a returning stream again after another one played', () => {
        play(0, 1, 2);
        target = streamB;
        play(0, 1, 2);
        target = streamA;
        play(0, 1, 2);

        expect(confirm).toHaveBeenCalledTimes(3);
    });

    it('keeps progress across an engine swap of the same stream', () => {
        play(0, 1.5);
        revision = Symbol('fallback');
        play(30, 30.5);

        expect(confirm).toHaveBeenCalledTimes(1);
    });

    it('ignores position changes reported while not playing', () => {
        confirmation.record(0, false);
        confirmation.record(1, false);
        confirmation.record(2, false);

        expect(confirm).not.toHaveBeenCalled();
    });
});
