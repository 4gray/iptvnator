import { reconcilePendingLiveSeek } from './embedded-mpv-pending-seek';

describe('buffered live seek acknowledgement', () => {
    const request = (seconds: number, requestedAt = 1000) => ({
        seconds,
        requestedAt,
    });
    const pending = {
        observed: 75.6,
        targets: [request(65.6)],
        observedAt: 1000,
    };
    it('retains a target while ordinary playback advances', () => {
        expect(reconcilePendingLiveSeek(pending, 75.7, 1100, true).base).toBe(
            65.6
        );
        expect(
            reconcilePendingLiveSeek(pending, 76.6, 1500, true, 2).base
        ).toBe(65.6);
    });
    it('acknowledges a completed seek, an unrelated discontinuity or an expired request', () => {
        expect(reconcilePendingLiveSeek(pending, 65.7, 1100, true).base).toBe(
            65.7
        );
        expect(reconcilePendingLiveSeek(pending, 25.6, 1100, false).base).toBe(
            25.6
        );
        expect(reconcilePendingLiveSeek(pending, 78.6, 4000, true).base).toBe(
            78.6
        );
        expect(
            reconcilePendingLiveSeek(undefined, 75.6, 1000, false).base
        ).toBe(75.6);
    });

    it('retains the latest intent when an earlier request is acknowledged', () => {
        expect(
            reconcilePendingLiveSeek(
                {
                    ...pending,
                    targets: [request(65.6), request(55.6)],
                },
                65.7,
                1100,
                true
            )
        ).toEqual({ base: 55.6, outstandingTargets: [request(55.6)] });
        expect(
            reconcilePendingLiveSeek(
                {
                    ...pending,
                    targets: [request(65.6), request(55.6), request(45.6)],
                },
                55.7,
                1100,
                true
            )
        ).toEqual({ base: 45.6, outstandingTargets: [request(45.6)] });
    });

    it('uses authoritative playback only after the latest target is acknowledged', () => {
        expect(
            reconcilePendingLiveSeek(
                {
                    ...pending,
                    targets: [request(65.6), request(55.6)],
                },
                56.1,
                1500,
                true
            )
        ).toEqual({ base: 56.1, outstandingTargets: [] });
    });

    it("measures an older acknowledgement against that request's own clock", () => {
        expect(
            reconcilePendingLiveSeek(
                {
                    observed: 77.1,
                    observedAt: 2500,
                    targets: [request(65.6), request(55.6, 2500)],
                },
                67.2,
                2600,
                true
            )
        ).toEqual({
            base: 55.6,
            outstandingTargets: [request(55.6, 2500)],
        });
    });
});
