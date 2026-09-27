import { PlaybackHistoryGate } from './playback-history-gate.service';

describe('PlaybackHistoryGate', () => {
    let gate: PlaybackHistoryGate;

    beforeEach(() => {
        gate = new PlaybackHistoryGate();
    });

    it('holds a write until one of its keys is confirmed', () => {
        const commit = jest.fn();
        gate.defer(['http://stream/1', 'live:p1:c1'], commit);

        expect(commit).not.toHaveBeenCalled();

        gate.confirm(['live:p1:c1']);

        expect(commit).toHaveBeenCalledTimes(1);
    });

    it('never commits a write whose stream is not confirmed', () => {
        const failed = jest.fn();
        const played = jest.fn();
        gate.defer(['http://stream/failed'], failed);
        gate.defer(['http://stream/played'], played);

        gate.confirm(['http://stream/played']);

        expect(failed).not.toHaveBeenCalled();
        expect(played).toHaveBeenCalledTimes(1);
    });

    it('commits each confirmed write once', () => {
        const commit = jest.fn();
        gate.defer(['http://stream/1'], commit);

        gate.confirm(['http://stream/1']);
        gate.confirm(['http://stream/1']);

        expect(commit).toHaveBeenCalledTimes(1);
    });

    it('commits every writer deferred under the same key', () => {
        const first = jest.fn();
        const second = jest.fn();
        gate.defer(['http://stream/1'], first);
        gate.defer(['http://stream/1'], second);

        gate.confirm(['http://stream/1']);

        expect(first).toHaveBeenCalledTimes(1);
        expect(second).toHaveBeenCalledTimes(1);
    });

    it('commits immediately when a write has no usable key', () => {
        const commit = jest.fn();

        gate.defer([undefined, null, '  '], commit);

        expect(commit).toHaveBeenCalledTimes(1);
    });

    it('ignores confirmations without usable keys', () => {
        const commit = jest.fn();
        gate.defer(['http://stream/1'], commit);

        gate.confirm([undefined, '']);

        expect(commit).not.toHaveBeenCalled();
    });

    it('drops the oldest unconfirmed writes beyond its bound', () => {
        const oldest = jest.fn();
        gate.defer(['http://stream/oldest'], oldest);
        for (let index = 0; index < 20; index += 1) {
            gate.defer([`http://stream/${index}`], jest.fn());
        }

        gate.confirm(['http://stream/oldest']);

        expect(oldest).not.toHaveBeenCalled();
    });

    it('keeps committing the other writes when one throws', () => {
        const consoleError = jest
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);
        const failing = jest.fn(() => {
            throw new Error('db down');
        });
        const healthy = jest.fn();
        gate.defer(['http://stream/1'], failing);
        gate.defer(['http://stream/1'], healthy);

        gate.confirm(['http://stream/1']);

        expect(healthy).toHaveBeenCalledTimes(1);
        consoleError.mockRestore();
    });
});
