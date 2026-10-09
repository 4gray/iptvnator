import { signal } from '@angular/core';
import { ControlsTimeline } from './controls-timeline';
import { createEmptyControlsState } from './player-controls-defaults';
import type { PlayerControlsState } from './player-controls.model';

describe('buffered live timeline', () => {
    it('keeps elapsed time and VOD duration visible when seeking is unavailable', () => {
        const state = signal<PlayerControlsState>({
            ...createEmptyControlsState(),
            canSeek: false,
            positionSeconds: 75,
            durationSeconds: 120,
            seekStart: 0,
            seekEnd: 0,
        });
        const timeline = new ControlsTimeline(state);
        expect(timeline.value()).toBe(75);
        expect(timeline.duration()).toBe(120);
        expect(timeline.progress()).toBe(0);
        state.update((s) => ({ ...s, isLive: true, durationSeconds: null }));
        expect(timeline.value()).toBe(75);
        expect(timeline.duration()).toBe(0);
    });
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
        expect(timeline.segments()[0].startSeconds).toBe(60);
        expect(timeline.segments()[0].endSeconds).toBe(90);
        expect(timeline.fillPercent(timeline.segments()[0])).toBe(50);
        timeline.scrubPosition.set(65);
        state.update((s) => ({ ...s, seekStart: 70, seekEnd: 100 }));
        expect(timeline.value()).toBe(70);
        expect(timeline.progress()).toBe(0);
    });
});
