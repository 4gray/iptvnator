import { PlaybackProgressConfirmation } from './playback-progress-confirmation';

describe('PlaybackProgressConfirmation', () => {
    let onConfirmed: jest.Mock;
    let confirmation: PlaybackProgressConfirmation;

    const play = (...positions: number[]) =>
        positions.forEach((position) => confirmation.record(position));

    beforeEach(() => {
        onConfirmed = jest.fn();
        confirmation = new PlaybackProgressConfirmation(onConfirmed);
    });

    it('confirms once the stream has advanced for two seconds', () => {
        play(0, 0.5, 1, 1.5);
        expect(onConfirmed).not.toHaveBeenCalled();

        play(2);
        expect(onConfirmed).toHaveBeenCalledTimes(1);
    });

    it('confirms whole-second position reports (embedded MPV)', () => {
        play(10, 10, 11, 11, 12);

        expect(onConfirmed).toHaveBeenCalledTimes(1);
    });

    it('confirms only once per stream', () => {
        play(0, 1, 2, 3, 4, 5);

        expect(onConfirmed).toHaveBeenCalledTimes(1);
    });

    it('does not confirm a stream that stalls at its first frames', () => {
        play(0, 0.4, 0.4, 0.4, 0.4, 0.4);

        expect(onConfirmed).not.toHaveBeenCalled();
    });

    it('does not count a seek as watched time', () => {
        // A VOD resume jumps straight to the saved position.
        play(0, 1200, 1200.5);

        expect(onConfirmed).not.toHaveBeenCalled();
    });

    it('does not count short seeks of paused media', () => {
        confirmation.record(0, false);
        confirmation.record(1, false);
        confirmation.record(2, false);
        confirmation.record(2.5, false);

        expect(onConfirmed).not.toHaveBeenCalled();
    });

    it('counts only the steps reported while playing', () => {
        confirmation.record(0, true);
        confirmation.record(1.5, true);
        // Paused, then seeked a second ahead: not watched.
        confirmation.record(2.5, false);
        confirmation.record(2.9, true);

        expect(onConfirmed).not.toHaveBeenCalled();

        confirmation.record(3.5, true);
        expect(onConfirmed).toHaveBeenCalledTimes(1);
    });

    it('does not count backwards jumps', () => {
        play(5, 4, 3, 2, 1);

        expect(onConfirmed).not.toHaveBeenCalled();
    });

    it('ignores non-finite positions', () => {
        play(0, Number.NaN, Number.POSITIVE_INFINITY, 1);

        expect(onConfirmed).not.toHaveBeenCalled();
    });

    it('starts over after reset', () => {
        play(0, 1.5);
        confirmation.reset();
        play(100, 101);

        expect(onConfirmed).not.toHaveBeenCalled();

        play(102);
        expect(onConfirmed).toHaveBeenCalledTimes(1);
    });

    it('confirms again for a new stream after reset', () => {
        play(0, 1, 2);
        confirmation.reset();
        play(0, 1, 2);

        expect(onConfirmed).toHaveBeenCalledTimes(2);
    });

    it('keeps the progress across a rebase but not the position', () => {
        play(0, 1.5);
        confirmation.rebase();
        // The new engine's clock starts elsewhere; that jump is not counted.
        play(50, 50.5);

        expect(onConfirmed).toHaveBeenCalledTimes(1);
    });
});
