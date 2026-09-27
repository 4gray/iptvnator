import type { PlaybackHistoryKeys } from '@iptvnator/services';
import { PlaybackHistoryConfirmation } from './playback-history-confirmation';

describe('PlaybackHistoryConfirmation', () => {
    let keys: PlaybackHistoryKeys;
    let revision: symbol;
    let confirm: jest.Mock;
    let confirmation: PlaybackHistoryConfirmation;

    const play = (...positions: number[]) =>
        positions.forEach((position) => confirmation.record(position));

    beforeEach(() => {
        keys = ['live:p1:a', 'http://stream/a'];
        revision = Symbol('first');
        confirm = jest.fn();
        confirmation = new PlaybackHistoryConfirmation({
            gate: { confirm },
            keys: () => keys,
            sourceRevision: () => revision,
        });
    });

    it('confirms the keys of the stream that played', () => {
        play(0, 1, 2);

        expect(confirm).toHaveBeenCalledWith(['live:p1:a', 'http://stream/a']);
    });

    it('does not credit a new stream with the previous stream progress', () => {
        play(0, 1.5);
        keys = ['live:p1:b', 'http://stream/b'];
        play(0, 0.5);

        expect(confirm).not.toHaveBeenCalled();

        play(1, 2);
        expect(confirm).toHaveBeenCalledTimes(1);
        expect(confirm).toHaveBeenCalledWith(['live:p1:b', 'http://stream/b']);
    });

    it('confirms a returning stream again after another one played', () => {
        play(0, 1, 2);
        keys = ['live:p1:b', 'http://stream/b'];
        play(0, 1, 2);
        keys = ['live:p1:a', 'http://stream/a'];
        play(0, 1, 2);

        expect(confirm).toHaveBeenCalledTimes(3);
    });

    it('keeps progress across an engine swap of the same stream', () => {
        play(0, 1.5);
        revision = Symbol('fallback');
        play(30, 30.5);

        expect(confirm).toHaveBeenCalledTimes(1);
    });
});
