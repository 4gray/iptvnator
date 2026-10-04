import { signal } from '@angular/core';
import { ControlsTimeline } from './controls-timeline';
import { createEmptyControlsState } from './player-controls-defaults';

describe('buffered live timeline', () => {
    it('uses absolute range bounds and relative progress, including a moving buffer', () => {
        const state = signal({
            ...createEmptyControlsState(),
            isLive: true,
            canSeek: true,
            positionSeconds: 75,
            seekStart: 60,
            seekEnd: 90,
        });
        const timeline = new ControlsTimeline(state);
        expect(timeline.start()).toBe(60);
        expect(timeline.duration()).toBe(90);
        expect(timeline.progress()).toBe(50);
        timeline.scrubPosition.set(65);
        state.update((s) => ({ ...s, seekStart: 70, seekEnd: 100 }));
        expect(timeline.value()).toBe(70);
        expect(timeline.progress()).toBe(0);
    });
});
