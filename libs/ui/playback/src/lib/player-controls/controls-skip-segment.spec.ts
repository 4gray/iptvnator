import { WritableSignal, signal } from '@angular/core';
import {
    ControlsSkipSegment,
    SKIP_SEGMENT_END_MARGIN_SECONDS,
    activeSkipSegment,
} from './controls-skip-segment';
import {
    DEFAULT_PLAYER_CAPABILITIES,
    createEmptyControlsState,
} from './player-controls-defaults';
import type {
    PlayerControlsCapabilities,
    PlayerControlsState,
    PlayerSkipSegment,
} from './player-controls.model';

const recap: PlayerSkipSegment = {
    kind: 'recap',
    startSeconds: 0,
    endSeconds: 45,
};
const intro: PlayerSkipSegment = {
    kind: 'intro',
    startSeconds: 60,
    endSeconds: 120,
};

describe('activeSkipSegment', () => {
    it('finds the segment the position is inside', () => {
        expect(activeSkipSegment([recap, intro], 10)).toBe(recap);
        expect(activeSkipSegment([recap, intro], 60)).toBe(intro);
        expect(activeSkipSegment([recap, intro], 50)).toBeNull();
        expect(activeSkipSegment([recap, intro], 200)).toBeNull();
    });

    it('lets the button go just before the segment ends', () => {
        const nearEnd = intro.endSeconds - SKIP_SEGMENT_END_MARGIN_SECONDS;
        expect(activeSkipSegment([intro], nearEnd - 0.1)).toBe(intro);
        expect(activeSkipSegment([intro], nearEnd)).toBeNull();
    });

    it('ignores missing and non-finite segments', () => {
        expect(activeSkipSegment(null, 10)).toBeNull();
        expect(
            activeSkipSegment(
                [{ kind: 'intro', startSeconds: 0, endSeconds: NaN }],
                10
            )
        ).toBeNull();
    });
});

describe('ControlsSkipSegment', () => {
    let segments: WritableSignal<readonly PlayerSkipSegment[] | null>;
    let state: WritableSignal<PlayerControlsState>;
    let capabilities: WritableSignal<PlayerControlsCapabilities>;
    let showControls: WritableSignal<boolean>;
    let settingsOpen: WritableSignal<boolean>;
    let seekTo: jest.Mock<void, [number]>;
    let skip: ControlsSkipSegment;

    const at = (
        positionSeconds: number,
        overrides: Partial<PlayerControlsState> = {}
    ) =>
        state.set({
            ...createEmptyControlsState(),
            canSeek: true,
            durationSeconds: 1500,
            positionSeconds,
            ...overrides,
        });

    beforeEach(() => {
        segments = signal([recap, intro]);
        state = signal(createEmptyControlsState());
        capabilities = signal({ ...DEFAULT_PLAYER_CAPABILITIES, seek: true });
        showControls = signal(true);
        settingsOpen = signal(false);
        seekTo = jest.fn();
        skip = new ControlsSkipSegment({
            segments,
            state,
            capabilities,
            showControls,
            settingsOpen,
            seekTo,
        });
        at(70);
    });

    it('offers to skip the intro while it plays and seeks to its end', () => {
        expect(skip.segment()).toBe(intro);
        expect(skip.labelKey()).toBe('EMBEDDED_MPV.PLAYER.SKIP_INTRO');

        skip.skip();

        expect(seekTo).toHaveBeenCalledWith(120);
    });

    it('names a recap as a recap', () => {
        at(5);
        expect(skip.segment()).toBe(recap);
        expect(skip.labelKey()).toBe('EMBEDDED_MPV.PLAYER.SKIP_RECAP');
    });

    it('never seeks past the end of a shorter file', () => {
        at(70, { durationSeconds: 100 });
        skip.skip();
        expect(seekTo).toHaveBeenCalledWith(100);
    });

    it('skips an auto-skip segment once on entry and offers no button', () => {
        segments.set([recap, { ...intro, autoSkip: true }]);
        at(65);

        expect(skip.buttonSegment()).toBeNull();
        skip.autoSkip();
        skip.autoSkip();
        expect(seekTo).toHaveBeenCalledTimes(1);
        expect(seekTo).toHaveBeenCalledWith(120);

        // Seeking back in to watch it never loops.
        at(70);
        skip.autoSkip();
        expect(seekTo).toHaveBeenCalledTimes(1);
    });

    it('leaves segments without the flag to the button', () => {
        expect(skip.buttonSegment()).toBe(intro);
        skip.autoSkip();
        expect(seekTo).not.toHaveBeenCalled();
    });

    it.each<[string, () => void]>([
        ['the engine cannot seek', () => at(70, { canSeek: false })],
        ['the stream is live', () => at(70, { isLive: true })],
        [
            'seeking is not a capability',
            () =>
                capabilities.set({
                    ...DEFAULT_PLAYER_CAPABILITIES,
                    seek: false,
                }),
        ],
        ['the host withholds the controls', () => showControls.set(false)],
        ['the settings panel is open', () => settingsOpen.set(true)],
        ['no segments are known', () => segments.set(null)],
    ])('stays hidden when %s', (_reason, apply) => {
        apply();

        expect(skip.segment()).toBeNull();
        skip.skip();
        expect(seekTo).not.toHaveBeenCalled();
    });
});
