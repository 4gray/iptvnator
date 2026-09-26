import { WritableSignal, signal } from '@angular/core';
import { ControlsUpNext, UP_NEXT_THRESHOLD_SECONDS } from './controls-up-next';
import {
    DEFAULT_PLAYER_CAPABILITIES,
    createEmptyControlsState,
} from './player-controls-defaults';
import type {
    PlayerControlsCapabilities,
    PlayerControlsState,
    PlayerUpNextItem,
} from './player-controls.model';

describe('ControlsUpNext', () => {
    const next: PlayerUpNextItem = {
        label: 'S01E03',
        title: 'The Third One',
        thumbnailUrl: null,
        progressPercent: null,
    };
    let item: WritableSignal<PlayerUpNextItem | null>;
    let state: WritableSignal<PlayerControlsState>;
    let capabilities: WritableSignal<PlayerControlsCapabilities>;
    let showControls: WritableSignal<boolean>;
    let settingsOpen: WritableSignal<boolean>;
    let upNext: ControlsUpNext;

    const setState = (overrides: Partial<PlayerControlsState>) =>
        state.set({ ...createEmptyControlsState(), ...overrides });

    beforeEach(() => {
        item = signal(next);
        state = signal(createEmptyControlsState());
        capabilities = signal({
            ...DEFAULT_PLAYER_CAPABILITIES,
            seriesNavigation: true,
        });
        showControls = signal(true);
        settingsOpen = signal(false);
        upNext = new ControlsUpNext({
            item,
            state,
            capabilities,
            showControls,
            settingsOpen,
        });
        setState({
            canNextEpisode: true,
            durationSeconds: 1200,
            positionSeconds: 1200 - 7 * 60 - 3,
        });
    });

    it('shows the next episode inside the threshold with minutes left', () => {
        expect(upNext.visible()).toBe(true);
        expect(upNext.item()).toBe(next);
        expect(upNext.remainingSeconds()).toBe(423);
        expect(upNext.minutesLeft()).toBe(8);
    });

    it('stays hidden until the threshold and reports at least one minute', () => {
        setState({
            canNextEpisode: true,
            durationSeconds: 1200,
            positionSeconds: 1200 - UP_NEXT_THRESHOLD_SECONDS - 1,
        });
        expect(upNext.visible()).toBe(false);

        setState({
            canNextEpisode: true,
            durationSeconds: 1200,
            positionSeconds: 1200 - UP_NEXT_THRESHOLD_SECONDS,
        });
        expect(upNext.visible()).toBe(true);

        setState({
            canNextEpisode: true,
            durationSeconds: 1200,
            positionSeconds: 1199.5,
        });
        expect(upNext.minutesLeft()).toBe(1);
    });

    it('needs a supplied episode, a finite duration and a series-capable engine', () => {
        item.set(null);
        expect(upNext.visible()).toBe(false);
        item.set(next);

        // The host's item is authoritative: at a season's last episode the
        // transport cannot step forward, but the next season's first can.
        setState({
            canNextEpisode: false,
            durationSeconds: 1200,
            positionSeconds: 1100,
        });
        expect(upNext.visible()).toBe(true);

        setState({
            canNextEpisode: true,
            durationSeconds: null,
            positionSeconds: 1100,
        });
        expect(upNext.visible()).toBe(false);
        expect(upNext.remainingSeconds()).toBeNull();

        setState({
            canNextEpisode: true,
            isLive: true,
            durationSeconds: 1200,
            positionSeconds: 1100,
        });
        expect(upNext.visible()).toBe(false);

        setState({
            canNextEpisode: true,
            durationSeconds: 1200,
            positionSeconds: 1100,
        });
        capabilities.set({ ...DEFAULT_PLAYER_CAPABILITIES });
        expect(upNext.visible()).toBe(false);
    });

    it('does not count down once the episode has ended', () => {
        setState({
            status: 'ended',
            canNextEpisode: true,
            durationSeconds: 1200,
            positionSeconds: 1200,
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
