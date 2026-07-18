import { ControlsMenuSelection } from './controls-menu-selection';
import { ControlsMenuState } from './controls-menu-state';
import { ControlsVisibility } from './controls-visibility';
import type { PlayerControlsCommands } from './player-controls.model';

describe('ControlsMenuSelection', () => {
    let commands: jest.Mocked<PlayerControlsCommands>;
    let menus: ControlsMenuState;
    let visibility: ControlsVisibility;
    let revealSticky: jest.Mock;
    let selection: ControlsMenuSelection;

    beforeEach(() => {
        commands = {
            togglePlay: jest.fn(),
            seekTo: jest.fn(),
            seekBy: jest.fn(),
            setVolume: jest.fn(),
            setAudioTrack: jest.fn(),
            setSubtitleTrack: jest.fn(),
            setPlaybackSpeed: jest.fn(),
            setAspectRatio: jest.fn(),
            toggleRecording: jest.fn(),
            togglePictureInPicture: jest.fn(),
        };
        menus = new ControlsMenuState();
        visibility = new ControlsVisibility(() => false);
        jest.spyOn(visibility, 'scheduleHide');
        revealSticky = jest.fn();
        selection = new ControlsMenuSelection({
            commands: () => commands,
            menus,
            visibility,
            revealSticky,
        });
    });

    it('toggles a menu through the menu state', () => {
        selection.toggle('audio');
        expect(menus.audioOpen()).toBe(true);

        selection.toggle('audio');
        expect(menus.audioOpen()).toBe(false);
    });

    it('selects an audio track: reveal sticky, command, close menu, reschedule hide', () => {
        menus.open('audio');
        selection.audioTrack(3);

        expect(revealSticky).toHaveBeenCalledTimes(1);
        expect(commands.setAudioTrack).toHaveBeenCalledWith(3);
        expect(menus.audioOpen()).toBe(false);
        expect(visibility.scheduleHide).toHaveBeenCalledTimes(1);
    });

    it('selects a subtitle track and closes the subtitle menu', () => {
        menus.open('subtitle');
        selection.subtitleTrack(-1);

        expect(commands.setSubtitleTrack).toHaveBeenCalledWith(-1);
        expect(menus.subtitleOpen()).toBe(false);
        expect(visibility.scheduleHide).toHaveBeenCalled();
    });

    it('applies a playback speed and closes the speed menu', () => {
        menus.open('speed');
        selection.speed(1.5);

        expect(commands.setPlaybackSpeed).toHaveBeenCalledWith(1.5);
        expect(menus.speedOpen()).toBe(false);
    });

    it('applies an aspect ratio and closes the aspect menu', () => {
        menus.open('aspect');
        selection.aspect('16:9');

        expect(commands.setAspectRatio).toHaveBeenCalledWith('16:9');
        expect(menus.aspectOpen()).toBe(false);
    });

    it('only closes the menu the selection belongs to', () => {
        menus.open('volume');
        selection.speed(2);

        // Closing 'speed' must not blindly close every popover.
        expect(menus.volumeOpen()).toBe(true);
    });
});
