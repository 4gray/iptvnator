import { ControlsMenuSelection } from './controls-menu-selection';
import type { PlayerControlsCommands } from './player-controls.model';

describe('ControlsMenuSelection', () => {
    let commands: jest.Mocked<PlayerControlsCommands>;
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
            addExternalSubtitleFile: jest.fn(),
            setSubtitleDelay: jest.fn(),
            setSubtitleStyle: jest.fn(),
            setQualityLevel: jest.fn(),
            setPlaybackSpeed: jest.fn(),
            setAspectRatio: jest.fn(),
            toggleRecording: jest.fn(),
            togglePictureInPicture: jest.fn(),
        };
        revealSticky = jest.fn();
        selection = new ControlsMenuSelection({
            commands: () => commands,
            revealSticky,
        });
    });

    it('selects an audio track: reveal sticky, then the command', () => {
        selection.audioTrack(3);

        expect(revealSticky).toHaveBeenCalledTimes(1);
        expect(commands.setAudioTrack).toHaveBeenCalledWith(3);
    });

    it.each([
        ['subtitleTrack', -1, 'setSubtitleTrack'],
        ['qualityLevel', -1, 'setQualityLevel'],
        ['speed', 1.5, 'setPlaybackSpeed'],
        ['aspect', '16:9', 'setAspectRatio'],
    ] as const)('routes %s to the engine command', (method, value, command) => {
        (selection[method] as (arg: unknown) => void)(value);

        expect(revealSticky).toHaveBeenCalledTimes(1);
        expect(commands[command]).toHaveBeenCalledWith(value);
    });

    it('opens the subtitle file picker', () => {
        selection.externalSubtitle();

        expect(commands.addExternalSubtitleFile).toHaveBeenCalledTimes(1);
    });
});
