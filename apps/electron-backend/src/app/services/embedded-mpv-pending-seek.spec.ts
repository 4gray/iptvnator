import { pendingLiveSeekBase } from './embedded-mpv-pending-seek';

describe('buffered live seek acknowledgement', () => {
    const pending = { observed: 75.6, target: 65.6, observedAt: 1000 };
    it('retains a target while ordinary playback advances', () => {
        expect(pendingLiveSeekBase(pending, 75.7, 1100, true)).toBe(65.6);
        expect(pendingLiveSeekBase(pending, 76.6, 1500, true, 2)).toBe(65.6);
    });
    it('acknowledges a completed seek, an unrelated discontinuity or an expired request', () => {
        expect(pendingLiveSeekBase(pending, 65.7, 1100, true)).toBe(65.7);
        expect(pendingLiveSeekBase(pending, 25.6, 1100, false)).toBe(25.6);
        expect(pendingLiveSeekBase(pending, 78.6, 4000, true)).toBe(78.6);
        expect(pendingLiveSeekBase(undefined, 75.6, 1000, false)).toBe(75.6);
    });
});
