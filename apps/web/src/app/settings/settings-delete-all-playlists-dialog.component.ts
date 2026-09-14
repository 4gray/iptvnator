import { CommonModule } from '@angular/common';
import {
    Component,
    computed,
    inject,
    ChangeDetectionStrategy,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { TranslateModule } from '@ngx-translate/core';

export interface SettingsDeleteAllPlaylistsDialogData {
    summary: {
        total: number;
        m3u: number;
        xtream: number;
        stalker: number;
    };
}

type SettingsDeleteSummaryItem = {
    count: number;
    icon: string;
    id: 'm3u' | 'xtream' | 'stalker';
    labelKey: string;
};

@Component({
    selector: 'app-settings-delete-all-playlists-dialog',
    templateUrl: './settings-delete-all-playlists-dialog.component.html',
    styleUrls: ['./settings-delete-all-playlists-dialog.component.scss'],
    // eslint-disable-next-line @angular-eslint/prefer-on-push-component-change-detection -- Preserve pre-Angular 22 eager checking during the framework upgrade.
    changeDetection: ChangeDetectionStrategy.Eager,
    imports: [
        CommonModule,
        MatButtonModule,
        MatDialogModule,
        MatIconModule,
        TranslateModule,
    ],
})
export class SettingsDeleteAllPlaylistsDialogComponent {
    readonly dialogData =
        inject<SettingsDeleteAllPlaylistsDialogData>(MAT_DIALOG_DATA);

    readonly summaryItems = computed<SettingsDeleteSummaryItem[]>(() => [
        {
            id: 'm3u',
            count: this.dialogData.summary.m3u,
            icon: 'playlist_play',
            labelKey: 'HOME.PLAYLIST_TYPES.M3U',
        },
        {
            id: 'xtream',
            count: this.dialogData.summary.xtream,
            icon: 'cloud',
            labelKey: 'HOME.PLAYLIST_TYPES.XTREAM',
        },
        {
            id: 'stalker',
            count: this.dialogData.summary.stalker,
            icon: 'router',
            labelKey: 'HOME.PLAYLIST_TYPES.STALKER',
        },
    ]);

    readonly consequenceKeys = [
        'SETTINGS.REMOVE_DIALOG.CONSEQUENCE_FAVORITES',
        'SETTINGS.REMOVE_DIALOG.CONSEQUENCE_RECENTLY_VIEWED',
        'SETTINGS.REMOVE_DIALOG.CONSEQUENCE_PLAYBACK',
        'SETTINGS.REMOVE_DIALOG.CONSEQUENCE_DOWNLOADS',
        'SETTINGS.REMOVE_DIALOG.CONSEQUENCE_XTREAM_CACHE',
    ] as const;
}
