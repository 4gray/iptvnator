import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import {
    WorkspaceCommandContribution,
    WorkspaceViewCommandService,
} from '@iptvnator/portal/shared/util';
import { SettingsStore } from '@iptvnator/services';
import { VideoPlayer } from '@iptvnator/shared/interfaces';
import { WorkspacePlayerCommandsContributor } from './workspace-player-commands.contributor';

interface ViewCommandsMock {
    registerCommand: jest.Mock;
    commands: jest.Mock;
}

interface SettingsStoreMock {
    player: ReturnType<typeof signal<VideoPlayer>>;
    updateSettings: jest.Mock;
}

interface SnackBarMock {
    open: jest.Mock;
}

function getRegistered(
    viewCommands: ViewCommandsMock
): WorkspaceCommandContribution[] {
    return viewCommands.registerCommand.mock.calls.map(
        ([command]: [WorkspaceCommandContribution]) => command
    );
}

function resolveBoolean(
    value: boolean | (() => boolean | undefined) | undefined
): boolean {
    if (typeof value === 'function') {
        return value() ?? true;
    }
    return value ?? true;
}

describe('WorkspacePlayerCommandsContributor', () => {
    let viewCommands: ViewCommandsMock;
    let settingsStore: SettingsStoreMock;
    let snackBar: SnackBarMock;
    let translate: { instant: jest.Mock; onLangChange: ReturnType<typeof of> };

    function bootstrap(options: { isDesktop: boolean }) {
        if (options.isDesktop) {
            window.electron = { platform: 'darwin' } as typeof window.electron;
        } else {
            // @ts-expect-error - simulating PWA environment
            window.electron = undefined;
        }

        viewCommands = {
            registerCommand: jest.fn().mockReturnValue(() => undefined),
            commands: jest.fn().mockReturnValue([]),
        };
        settingsStore = {
            player: signal<VideoPlayer>(VideoPlayer.VideoJs),
            updateSettings: jest.fn().mockResolvedValue(undefined),
        };
        snackBar = { open: jest.fn() };
        translate = {
            instant: jest.fn(
                (key: string, params?: Record<string, string | number>) =>
                    params?.['name']
                        ? `${key}:${params['name']}`
                        : key
            ),
            onLangChange: of(null),
        };

        TestBed.configureTestingModule({
            providers: [
                WorkspacePlayerCommandsContributor,
                {
                    provide: WorkspaceViewCommandService,
                    useValue: viewCommands,
                },
                { provide: SettingsStore, useValue: settingsStore },
                { provide: MatSnackBar, useValue: snackBar },
                { provide: TranslateService, useValue: translate },
            ],
        });

        return TestBed.inject(WorkspacePlayerCommandsContributor);
    }

    afterEach(() => {
        TestBed.resetTestingModule();
    });

    it('registers all five player commands when running in Electron', () => {
        bootstrap({ isDesktop: true });

        const ids = getRegistered(viewCommands).map((c) => c.id);
        expect(ids).toEqual([
            'switch-player-videojs',
            'switch-player-html5',
            'switch-player-artplayer',
            'switch-player-mpv',
            'switch-player-vlc',
        ]);
    });

    it('hides MPV and VLC when window.electron is unavailable', () => {
        bootstrap({ isDesktop: false });

        const registered = getRegistered(viewCommands);
        const visibilityById = Object.fromEntries(
            registered.map((c) => [c.id, resolveBoolean(c.visible)])
        );

        expect(visibilityById['switch-player-videojs']).toBe(true);
        expect(visibilityById['switch-player-html5']).toBe(true);
        expect(visibilityById['switch-player-artplayer']).toBe(true);
        expect(visibilityById['switch-player-mpv']).toBe(false);
        expect(visibilityById['switch-player-vlc']).toBe(false);
    });

    it('marks the active player command as disabled', () => {
        bootstrap({ isDesktop: true });
        settingsStore.player.set(VideoPlayer.MPV);

        const registered = getRegistered(viewCommands);
        const enabledById = Object.fromEntries(
            registered.map((c) => [c.id, resolveBoolean(c.enabled)])
        );

        expect(enabledById['switch-player-mpv']).toBe(false);
        expect(enabledById['switch-player-videojs']).toBe(true);
        expect(enabledById['switch-player-vlc']).toBe(true);
    });

    it('updates settings and shows feedback on run', () => {
        bootstrap({ isDesktop: true });

        const mpvCommand = getRegistered(viewCommands).find(
            (c) => c.id === 'switch-player-mpv'
        );
        mpvCommand?.run({ query: '' });

        expect(settingsStore.updateSettings).toHaveBeenCalledWith({
            player: VideoPlayer.MPV,
        });
        expect(snackBar.open).toHaveBeenCalledTimes(1);
        const [message, action, config] = snackBar.open.mock.calls[0];
        expect(message).toContain(
            'WORKSPACE.SHELL.COMMANDS.SWITCH_PLAYER_FEEDBACK'
        );
        expect(action).toBeUndefined();
        expect(config?.duration).toBe(2500);
    });
});
