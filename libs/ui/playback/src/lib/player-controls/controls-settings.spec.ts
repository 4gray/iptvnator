import { WritableSignal, signal } from '@angular/core';
import { ControlsMenuState } from './controls-menu-state';
import { ControlsSettings } from './controls-settings';
import {
    DEFAULT_PLAYER_CAPABILITIES,
    createEmptyControlsState,
} from './player-controls-defaults';
import type {
    PlayerControlsCapabilities,
    PlayerControlsCommands,
    PlayerControlsState,
} from './player-controls.model';

describe('ControlsSettings', () => {
    let state: WritableSignal<PlayerControlsState>;
    let capabilities: WritableSignal<PlayerControlsCapabilities>;
    let showControls: WritableSignal<boolean>;
    let menus: ControlsMenuState;
    let commands: jest.Mocked<PlayerControlsCommands>;
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
        commands = {
            togglePlay: jest.fn(),
            seekTo: jest.fn(),
            seekBy: jest.fn(),
            setVolume: jest.fn(),
            setAudioTrack: jest.fn(),
            setSubtitleTrack: jest.fn(),
            addExternalSubtitleFile: jest.fn(),
            setSubtitleDelay: jest.fn(),
            setSubtitleStyle: jest.fn(),
            setQualityLevel: jest.fn(),
            setPlaybackSpeed: jest.fn(),
            setAspectRatio: jest.fn(),
            toggleRecording: jest.fn(),
            togglePictureInPicture: jest.fn(),
        };
        reveal = jest.fn();
        settings = new ControlsSettings({
            state,
            capabilities,
            showControls,
            menus,
            commands: () => commands,
            reveal,
        });
    });

    it('is unavailable without any group and cannot open', () => {
        expect(settings.available()).toBe(false);

        settings.open('speed');
        settings.toggle();

        expect(menus.settingsOpen()).toBe(false);
        expect(settings.isOpen()).toBe(false);
        expect(reveal).not.toHaveBeenCalled();
    });

    it('opens on a group with a sticky reveal and toggles closed', () => {
        setCapabilities({ playbackSpeed: true });

        settings.open('speed');
        expect(settings.isOpen()).toBe(true);
        expect(settings.focusGroup()).toBe('speed');
        expect(reveal).toHaveBeenCalledWith({ scheduleHide: false });

        settings.toggle();
        expect(settings.isOpen()).toBe(false);
        expect(settings.focusGroup()).toBeNull();
    });

    it('is hidden with the controls even while the menu flag is set', () => {
        setCapabilities({ playbackSpeed: true });
        settings.open();
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
        expect(settings.subtitleLabel()).toBeNull();
        expect(settings.speedLabel()).toBe('1×');

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
        expect(settings.subtitleLabel()).toBe('Russian');
        expect(settings.audioModified()).toBe(true);
        expect(settings.qualityModified()).toBe(true);
        expect(settings.speedModified()).toBe(true);
        expect(settings.speedLabel()).toBe('1.25×');
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

    it('toggles subtitles from the chip without opening the panel', () => {
        setCapabilities({ subtitles: true });
        setState({
            subtitleTracks: [
                { id: 7, label: 'English', selected: false },
                { id: 8, label: 'German', selected: false },
            ],
        });
        const event = { preventDefault: jest.fn() } as unknown as Event;

        settings.onSubtitleChipContextMenu(event);
        expect(event.preventDefault).toHaveBeenCalled();
        expect(commands.setSubtitleTrack).toHaveBeenCalledWith(7);
        expect(menus.settingsOpen()).toBe(false);

        setState({
            subtitleTracks: [{ id: 7, label: 'English', selected: true }],
            subtitlesEnabled: true,
        });
        settings.toggleSubtitles();
        expect(commands.setSubtitleTrack).toHaveBeenLastCalledWith(-1);
    });

    it('opens the subtitles group instead when there is no track to turn on', () => {
        setCapabilities({ externalSubtitles: true });

        settings.toggleSubtitles();

        expect(commands.setSubtitleTrack).not.toHaveBeenCalled();
        expect(settings.isOpen()).toBe(true);
        expect(settings.focusGroup()).toBe('subtitles');
    });

    it('ignores the subtitle toggle without a subtitle group', () => {
        settings.toggleSubtitles();
        expect(commands.setSubtitleTrack).not.toHaveBeenCalled();
        expect(reveal).not.toHaveBeenCalled();
    });
});
