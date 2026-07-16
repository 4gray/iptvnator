import { CommonModule } from '@angular/common';
import { Component, input, output, ViewEncapsulation } from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { TranslateModule } from '@ngx-translate/core';
import { StreamFormat, VideoPlayer } from '@iptvnator/shared/interfaces';
import { SettingsPlayerOption } from './settings.models';

const BUILT_IN_INLINE_PLAYERS = new Set<VideoPlayer>([
    VideoPlayer.VideoJs,
    VideoPlayer.Html5Player,
    VideoPlayer.ArtPlayer,
    VideoPlayer.EmbeddedMpv,
]);

@Component({
    selector: 'app-settings-playback-section',
    imports: [
        CommonModule,
        MatButtonModule,
        MatCheckboxModule,
        MatFormFieldModule,
        MatIconModule,
        MatInputModule,
        MatSelectModule,
        ReactiveFormsModule,
        TranslateModule,
    ],
    templateUrl: './settings-playback-section.component.html',
    encapsulation: ViewEncapsulation.None,
    styles: [':host { display: contents; }'],
})
export class SettingsPlaybackSectionComponent {
    readonly mpvPlayerArgumentsPlaceholder = [
        '--ontop',
        '--autofit=640x360',
        '--geometry=+80+80',
    ].join('\n');
    readonly vlcPlayerArgumentsPlaceholder = [
        '--video-on-top',
        '--width=640',
        '--height=360',
    ].join('\n');

    readonly form = input.required<FormGroup>();
    readonly activeSection = input.required<string>();
    readonly players = input.required<SettingsPlayerOption[]>();
    readonly streamFormatEnum = input.required<typeof StreamFormat>();
    readonly isDesktop = input(false);
    /** Frame-copy embedded MPV engine is possible on this machine */
    readonly frameCopyAvailable = input(false);
    /** Frame-copy engine is what the current app run actually uses */
    readonly frameCopyActive = input(false);
    readonly supportsManagedExternalPlayers = input(false);
    readonly supportsExternalPlayerPathSettings = input(false);
    readonly selectRecordingFolder = output<void>();

    isExternalPlayerSelected(): boolean {
        const player = this.form().value.player;
        return player === VideoPlayer.MPV || player === VideoPlayer.VLC;
    }

    isBuiltInInlinePlayerSelected(): boolean {
        const player = this.form().value.player;
        return BUILT_IN_INLINE_PLAYERS.has(player);
    }
}
