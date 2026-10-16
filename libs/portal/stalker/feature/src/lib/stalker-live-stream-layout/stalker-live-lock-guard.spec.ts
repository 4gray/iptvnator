import { isStalkerPlaybackRequestLockCurrent } from './stalker-live-lock-guard';

describe('isStalkerPlaybackRequestLockCurrent', () => {
    it('lets an unchanged lock version through', () => {
        expect(isStalkerPlaybackRequestLockCurrent(3, 3, true)).toBe(true);
        expect(isStalkerPlaybackRequestLockCurrent(3, 3, false)).toBe(true);
    });

    it('retires a request the session relocked over', () => {
        expect(isStalkerPlaybackRequestLockCurrent(3, 4, true)).toBe(false);
    });

    it('lets a request through when the change was an unlock', () => {
        expect(isStalkerPlaybackRequestLockCurrent(3, 4, false)).toBe(true);
    });
});
