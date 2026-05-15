import { DestroyRef, Injectable, inject } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslateService } from '@ngx-translate/core';
import {
    WorkspaceCommandContribution,
    WorkspaceViewCommandService,
} from '@iptvnator/portal/shared/util';
import { SettingsStore } from '@iptvnator/services';
import { VideoPlayer } from '@iptvnator/shared/interfaces';

interface PlayerCommandDefinition {
    id: string;
    player: VideoPlayer;
    icon: string;
    nameKey: string;
    keywords: readonly string[];
    desktopOnly: boolean;
    priority: number;
}

const PLAYER_COMMAND_DEFS: readonly PlayerCommandDefinition[] = [
    {
        id: 'switch-player-videojs',
        player: VideoPlayer.VideoJs,
        icon: 'play_circle',
        nameKey: 'SETTINGS.PLAYER_VIDEOJS',
        keywords: ['player', 'videojs', 'video.js'],
        desktopOnly: false,
        priority: 90,
    },
    {
        id: 'switch-player-html5',
        player: VideoPlayer.Html5Player,
        icon: 'play_circle',
        nameKey: 'SETTINGS.PLAYER_HTML5',
        keywords: ['player', 'html5'],
        desktopOnly: false,
        priority: 91,
    },
    {
        id: 'switch-player-artplayer',
        player: VideoPlayer.ArtPlayer,
        icon: 'play_circle',
        nameKey: 'SETTINGS.PLAYER_ARTPLAYER',
        keywords: ['player', 'artplayer', 'art'],
        desktopOnly: false,
        priority: 92,
    },
    {
        id: 'switch-player-mpv',
        player: VideoPlayer.MPV,
        icon: 'play_circle_outline',
        nameKey: 'SETTINGS.PLAYER_MPV',
        keywords: ['player', 'mpv', 'external'],
        desktopOnly: true,
        priority: 93,
    },
    {
        id: 'switch-player-vlc',
        player: VideoPlayer.VLC,
        icon: 'play_circle_outline',
        nameKey: 'SETTINGS.PLAYER_VLC',
        keywords: ['player', 'vlc', 'external'],
        desktopOnly: true,
        priority: 94,
    },
];

@Injectable({ providedIn: 'root' })
export class WorkspacePlayerCommandsContributor {
    private readonly viewCommands = inject(WorkspaceViewCommandService);
    private readonly settingsStore = inject(SettingsStore);
    private readonly snackBar = inject(MatSnackBar);
    private readonly translate = inject(TranslateService);
    private readonly destroyRef = inject(DestroyRef);

    private readonly isDesktop = !!window.electron;

    constructor() {
        const unregisters = PLAYER_COMMAND_DEFS.map((def) =>
            this.viewCommands.registerCommand(this.toContribution(def))
        );

        this.destroyRef.onDestroy(() => {
            for (const unregister of unregisters) {
                unregister();
            }
        });
    }

    private toContribution(
        def: PlayerCommandDefinition
    ): WorkspaceCommandContribution {
        return {
            id: def.id,
            group: 'global',
            icon: def.icon,
            labelKey: 'WORKSPACE.SHELL.COMMANDS.SWITCH_PLAYER_LABEL',
            labelParams: () => ({ name: this.translate.instant(def.nameKey) }),
            descriptionKey: 'WORKSPACE.SHELL.COMMANDS.SWITCH_PLAYER_DESCRIPTION',
            descriptionParams: () => ({
                name: this.translate.instant(def.nameKey),
            }),
            keywords: () => [
                ...def.keywords,
                this.translate.instant(def.nameKey).toLowerCase(),
            ],
            priority: def.priority,
            visible: () => !def.desktopOnly || this.isDesktop,
            enabled: () => this.settingsStore.player() !== def.player,
            run: () => this.activate(def),
        };
    }

    private activate(def: PlayerCommandDefinition): void {
        void this.settingsStore.updateSettings({ player: def.player });

        const name = this.translate.instant(def.nameKey);
        this.snackBar.open(
            this.translate.instant(
                'WORKSPACE.SHELL.COMMANDS.SWITCH_PLAYER_FEEDBACK',
                { name }
            ),
            undefined,
            {
                duration: 2500,
                horizontalPosition: 'center',
                verticalPosition: 'bottom',
            }
        );
    }
}
