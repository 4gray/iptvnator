import { computed } from '@angular/core';
import { createPendingPlaybackStart } from './pending-playback-start';

describe('createPendingPlaybackStart', () => {
    it('is pending only for the owner of the latest start', () => {
        const tracker = createPendingPlaybackStart<string>();
        const pendingForA = computed(() => tracker.isPendingFor('a'));
        const pendingForB = computed(() => tracker.isPendingFor('b'));

        expect(pendingForA()).toBe(false);
        const first = tracker.begin('a');
        expect(pendingForA()).toBe(true);
        expect(pendingForB()).toBe(false);

        tracker.settle(first);
        expect(pendingForA()).toBe(false);
    });

    it('forgets a start whose owner the page left, so a return is not held by it', () => {
        const tracker = createPendingPlaybackStart<string>();
        const first = tracker.begin('a');

        // Back out of the movie while its request still resolves: whatever
        // it settles with no longer applies, so reopening it starts afresh.
        tracker.retire('a');
        expect(tracker.isPendingFor('a')).toBe(false);

        // The retired start settling late must not disturb a newer one.
        const newer = tracker.begin('a');
        tracker.settle(first);
        expect(tracker.isPendingFor('a')).toBe(true);
        tracker.settle(newer);
        expect(tracker.isPendingFor('a')).toBe(false);
    });

    it('lets only the latest start clear the flag', () => {
        const tracker = createPendingPlaybackStart<string>();
        const older = tracker.begin('a');
        const newer = tracker.begin('b');

        tracker.settle(older);
        expect(tracker.isPendingFor('b')).toBe(true);

        tracker.settle(newer);
        expect(tracker.isPendingFor('b')).toBe(false);
    });
});
