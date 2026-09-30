import { WritableSignal, signal } from '@angular/core';
import {
    ControlsUpNext,
    UP_NEXT_MAX_CREDITS_LEAD_SECONDS,
    creditsStartSeconds,
    upNextThresholdSeconds,
} from './controls-up-next';
import {
    DEFAULT_PLAYER_CAPABILITIES,
    createEmptyControlsState,
} from './player-controls-defaults';
import type {
    PlayerControlsCapabilities,
    PlayerControlsState,
    PlayerTimelineSegment,
    PlayerUpNextItem,
} from './player-controls.model';

describe('upNextThresholdSeconds', () => {
    it.each([
        [10 * 60, 40],
        [22 * 60, 53],
        [45 * 60, 108],
        [60 * 60, 144],
        [90 * 60, 180],
        [3 * 60 * 60, 180],
    ])('gives a %i s episode a %i s lead', (duration, lead) => {
        expect(upNextThresholdSeconds(duration)).toBe(lead);
    });
});

describe('creditsStartSeconds', () => {
    const chapter = (
        startSeconds: number,
        title: string | null
    ): PlayerTimelineSegment => ({
        startSeconds,
        endSeconds: startSeconds + 60,
        title,
    });

    it('finds the earliest credits chapter in the last third', () => {
        expect(
            creditsStartSeconds(
                [
                    chapter(0, 'Opening Credits'),
                    chapter(600, 'Part 2'),
                    chapter(2820, 'Post-credits scene'),
                    chapter(2700, 'End Credits'),
                ],
                3000
            )
        ).toBe(2700);
    });

    it('recognises anime ending themes and localized titles', () => {
        expect(creditsStartSeconds([chapter(1300, 'ED')], 1440)).toBe(1300);
        expect(creditsStartSeconds([chapter(1300, 'Титры')], 1440)).toBe(1300);
        expect(creditsStartSeconds([chapter(1300, 'Edge')], 1440)).toBeNull();
    });

    it('ignores untitled chapters and anything before the last third', () => {
        expect(
            creditsStartSeconds(
                [chapter(100, 'Credits'), chapter(2900, null)],
                3000
            )
        ).toBeNull();
        expect(creditsStartSeconds(null, 3000)).toBeNull();
    });
});

describe('ControlsUpNext', () => {
    const next: PlayerUpNextItem = {
        label: 'S01E03',
        title: 'The Third One',
        thumbnailUrl: null,
        progressPercent: null,
    };
    // A 20-minute episode gets the 48 s adaptive lead (4 %).
    const duration = 1200;
    const lead = 48;
    let item: WritableSignal<PlayerUpNextItem | null>;
    let state: WritableSignal<PlayerControlsState>;
    let capabilities: WritableSignal<PlayerControlsCapabilities>;
    let showControls: WritableSignal<boolean>;
    let settingsOpen: WritableSignal<boolean>;
    let segments: WritableSignal<readonly PlayerTimelineSegment[] | null>;
    let upNext: ControlsUpNext;

    const setState = (overrides: Partial<PlayerControlsState>) =>
        state.set({ ...createEmptyControlsState(), ...overrides });
    const at = (positionSeconds: number, durationSeconds = duration) =>
        setState({ canNextEpisode: true, durationSeconds, positionSeconds });

    beforeEach(() => {
        item = signal(next);
        state = signal(createEmptyControlsState());
        capabilities = signal({
            ...DEFAULT_PLAYER_CAPABILITIES,
            seriesNavigation: true,
        });
        showControls = signal(true);
        settingsOpen = signal(false);
        segments = signal(null);
        upNext = new ControlsUpNext({
            item,
            state,
            capabilities,
            showControls,
            settingsOpen,
            segments,
        });
        at(duration - 30);
    });

    it('shows the next episode inside the adaptive lead', () => {
        expect(upNext.thresholdSeconds()).toBe(lead);
        expect(upNext.visible()).toBe(true);
        expect(upNext.item()).toBe(next);
        expect(upNext.remainingSeconds()).toBe(30);
    });

    it('stays hidden until the adaptive lead is reached', () => {
        // The old fixed 8-minute lead would already show the card here.
        at(duration - 7 * 60);
        expect(upNext.visible()).toBe(false);

        at(duration - lead - 1);
        expect(upNext.visible()).toBe(false);

        at(duration - lead);
        expect(upNext.visible()).toBe(true);
    });

    it('appears when a closing-credits chapter starts instead', () => {
        segments.set([
            { startSeconds: 0, endSeconds: 1080, title: 'Episode' },
            { startSeconds: 1080, endSeconds: 1200, title: 'Credits' },
        ]);
        expect(upNext.thresholdSeconds()).toBe(120);

        at(1079);
        expect(upNext.visible()).toBe(false);
        at(1080);
        expect(upNext.visible()).toBe(true);
    });

    it('caps how far long credits bring the card forward', () => {
        segments.set([
            { startSeconds: 2400, endSeconds: 3600, title: 'End Credits' },
        ]);
        at(3000, 3600);
        expect(upNext.thresholdSeconds()).toBe(
            UP_NEXT_MAX_CREDITS_LEAD_SECONDS
        );
        expect(upNext.visible()).toBe(false);
    });

    it('stays dismissed for this next episode and returns for the following one', () => {
        upNext.dismiss();
        expect(upNext.visible()).toBe(false);

        at(duration - 10);
        expect(upNext.visible()).toBe(false);

        item.set({ ...next, label: 'S01E04', title: 'Four' });
        expect(upNext.visible()).toBe(true);
    });

    it('remembers the collapse for the episode it points to', () => {
        expect(upNext.collapsed()).toBe(false);
        upNext.collapse();
        expect(upNext.collapsed()).toBe(true);

        item.set({ ...next, label: 'S01E04', title: 'Four' });
        expect(upNext.collapsed()).toBe(false);
    });

    it('needs a supplied episode, a finite duration and a series-capable engine', () => {
        item.set(null);
        expect(upNext.visible()).toBe(false);
        item.set(next);

        // The host's item is authoritative: at a season's last episode the
        // transport cannot step forward, but the next season's first can.
        setState({
            canNextEpisode: false,
            durationSeconds: duration,
            positionSeconds: duration - 20,
        });
        expect(upNext.visible()).toBe(true);

        setState({
            canNextEpisode: true,
            durationSeconds: null,
            positionSeconds: duration - 20,
        });
        expect(upNext.visible()).toBe(false);
        expect(upNext.remainingSeconds()).toBeNull();
        expect(upNext.thresholdSeconds()).toBeNull();

        setState({
            canNextEpisode: true,
            isLive: true,
            durationSeconds: duration,
            positionSeconds: duration - 20,
        });
        expect(upNext.visible()).toBe(false);

        at(duration - 20);
        capabilities.set({ ...DEFAULT_PLAYER_CAPABILITIES });
        expect(upNext.visible()).toBe(false);
    });

    it('does not count down once the episode has ended', () => {
        setState({
            status: 'ended',
            canNextEpisode: true,
            durationSeconds: duration,
            positionSeconds: duration,
        });
        expect(upNext.visible()).toBe(false);
    });

    it('yields to hidden controls and to the open settings panel', () => {
        showControls.set(false);
        expect(upNext.visible()).toBe(false);
        showControls.set(true);

        settingsOpen.set(true);
        expect(upNext.visible()).toBe(false);
        settingsOpen.set(false);
        expect(upNext.visible()).toBe(true);
    });
});
