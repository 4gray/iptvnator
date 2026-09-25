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
