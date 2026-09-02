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
import {
    StreamFormat,
    VideoPlayer,
    reportsPlaybackFailures,
} from '@iptvnator/shared/interfaces';
import { SettingsPlayerOption } from './settings.models';

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
    readonly players = input.required<SettingsPlayerOption[]>();
    readonly streamFormatEnum = input.required<typeof StreamFormat>();
    readonly isDesktop = input(false);
    /** Frame-copy embedded MPV engine is possible on this machine */
    readonly frameCopyAvailable = input(false);
    /** Frame-copy engine is what the current app run actually uses */
    readonly frameCopyActive = input(false);
    readonly supportsManagedExternalPlayers = input(false);
    readonly supportsExternalPlayerPathSettings = input(false);
    /**
     * Cross-playlist movie matching is Electron-only, so the auto-failover
     * toggle would control nothing in the PWA.
     */
    readonly supportsVodMultiSource = input(false);
    readonly selectRecordingFolder = output<void>();

    isWebPlayerSelected(): boolean {
        return reportsPlaybackFailures(this.form().value.player);
    }

    /**
     * The fullscreen channel panel lives in the shared controls, which the
     * web players and Embedded MPV render; external MPV/VLC own their own
     * fullscreen, so the toggle would control nothing there.
     */
    supportsFullscreenChannelPanel(): boolean {
        return (
            this.isWebPlayerSelected() ||
            this.form().value.player === VideoPlayer.EmbeddedMpv
        );
    }

    isExternalPlayerSelected(): boolean {
        const player = this.form().value.player;
        return player === VideoPlayer.MPV || player === VideoPlayer.VLC;
    }
}
