import { WritableSignal, signal } from '@angular/core';
import { ControlsMenuState } from './controls-menu-state';
import { ControlsSettings } from './controls-settings';
import {
    DEFAULT_PLAYER_CAPABILITIES,
    createEmptyControlsState,
} from './player-controls-defaults';
import type {
    PlayerControlsCapabilities,
    PlayerControlsState,
} from './player-controls.model';

describe('ControlsSettings', () => {
    let state: WritableSignal<PlayerControlsState>;
    let capabilities: WritableSignal<PlayerControlsCapabilities>;
    let showControls: WritableSignal<boolean>;
    let menus: ControlsMenuState;
    let reveal: jest.Mock;
    let settings: ControlsSettings;

    const setState = (overrides: Partial<PlayerControlsState>) =>
        state.set({ ...createEmptyControlsState(), ...overrides });
    const setCapabilities = (overrides: Partial<PlayerControlsCapabilities>) =>
        capabilities.set({ ...DEFAULT_PLAYER_CAPABILITIES, ...overrides });

    beforeEach(() => {
        state = signal(createEmptyControlsState());
        capabilities = signal({ ...DEFAULT_PLAYER_CAPABILITIES });
        showControls = signal(true);
        menus = new ControlsMenuState();
        reveal = jest.fn();
        settings = new ControlsSettings({
            state,
            capabilities,
            showControls,
            menus,
            reveal,
        });
    });

    it('is unavailable without any group and cannot open', () => {
        expect(settings.available()).toBe(false);

        settings.toggle();

        expect(menus.settingsOpen()).toBe(false);
        expect(settings.isOpen()).toBe(false);
        expect(reveal).not.toHaveBeenCalled();
    });

    it('toggles the panel and reveals the controls', () => {
        setCapabilities({ playbackSpeed: true });

        settings.toggle();
        expect(settings.isOpen()).toBe(true);
        expect(reveal).toHaveBeenCalled();

        settings.toggle();
        expect(settings.isOpen()).toBe(false);
    });

    it('is hidden with the controls even while the menu flag is set', () => {
        setCapabilities({ playbackSpeed: true });
        settings.toggle();
        showControls.set(false);

        expect(settings.available()).toBe(false);
        expect(settings.isOpen()).toBe(false);
    });

    it('derives on/modified state and the tune dots', () => {
        setCapabilities({
            audioTracks: true,
            subtitles: true,
            playbackSpeed: true,
            aspectRatio: true,
            qualityLevels: true,
        });
        setState({
            audioTracks: [
                { id: 1, label: 'English', selected: true },
                { id: 2, label: 'German', selected: false },
            ],
            subtitleTracks: [{ id: 5, label: 'Russian', selected: false }],
            qualityLevels: [
                { id: 0, label: '1080p', selected: false },
                { id: 1, label: '720p', selected: false },
            ],
            qualityAutoEnabled: true,
        });
        expect(settings.dots()).toEqual({ cyan: false, violet: false });
        expect(settings.hasDots()).toBe(false);

        setState({
            audioTracks: [
                { id: 1, label: 'English', selected: false },
                { id: 2, label: 'German', selected: true },
            ],
            subtitleTracks: [{ id: 5, label: 'Russian', selected: true }],
            subtitlesEnabled: true,
            qualityLevels: [
                { id: 0, label: '1080p', selected: true },
                { id: 1, label: '720p', selected: false },
            ],
            qualityAutoEnabled: false,
            playbackSpeed: 1.25,
            aspectRatio: '16:9',
        });
        expect(settings.subtitlesOn()).toBe(true);
        expect(settings.audioModified()).toBe(true);
        expect(settings.qualityModified()).toBe(true);
        expect(settings.speedModified()).toBe(true);
        expect(settings.aspectModified()).toBe(true);
        expect(settings.dots()).toEqual({ cyan: true, violet: true });
    });

    it('treats the first aspect preset as the unmodified default', () => {
        setCapabilities({ aspectRatio: true });
        setState({
            aspectRatio: 'auto',
            aspectPresets: [
                { value: 'auto', label: 'Auto' },
                { value: '16:9', label: '16:9' },
            ],
        });
        expect(settings.defaultAspect()).toBe('auto');
        expect(settings.aspectModified()).toBe(false);
    });
});
