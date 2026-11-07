import { CommonModule } from '@angular/common';
import {
    Component,
    input,
    output,
    signal,
    computed,
    effect,
    ViewEncapsulation,
    ChangeDetectionStrategy,
} from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslateModule } from '@ngx-translate/core';
import {
    StreamFormat,
    VideoPlayer,
    reportsPlaybackFailures,
} from '@iptvnator/shared/interfaces';
import { SettingsPlayerOption } from './settings.models';
import { markSectionForCheckOnFormEvents } from './settings-section-form-render';
import { provideFormFieldDefaults } from '@iptvnator/ui/components/form-field-defaults';
import { merge } from 'rxjs';

@Component({
    selector: 'app-settings-playback-section',
    providers: [provideFormFieldDefaults()],
    imports: [
        CommonModule,
        MatButtonModule,
        MatFormFieldModule,
        MatIconModule,
        MatInputModule,
        MatSelectModule,
        MatSlideToggleModule,
        MatTooltipModule,
        ReactiveFormsModule,
        TranslateModule,
    ],
    templateUrl: './settings-playback-section.component.html',
    encapsulation: ViewEncapsulation.None,
    changeDetection: ChangeDetectionStrategy.OnPush,
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
    readonly externalAvailability = signal<{
        mpv: boolean | null;
        vlc: boolean | null;
    }>({
        mpv: null,
        vlc: null,
    });
    readonly checkingExternalPlayers = signal(false);
    readonly canCheckExternalPlayers = computed(
        () =>
            this.supportsExternalPlayerPathSettings() &&
            !!window.electron?.getExternalPlayerAvailability
    );
    private availabilityRequest = 0;

    constructor() {
        markSectionForCheckOnFormEvents(this.form);
        effect((onCleanup) => {
            const form = this.form();
            if (!this.canCheckExternalPlayers()) return;
            void this.refreshExternalAvailability();
            let timer: ReturnType<typeof setTimeout>;
            const subscription = merge(
                form.controls.mpvPlayerPath.valueChanges,
                form.controls.vlcPlayerPath.valueChanges
            ).subscribe(() => {
                this.availabilityRequest++;
                this.externalAvailability.set({ mpv: null, vlc: null });
                this.checkingExternalPlayers.set(true);
                clearTimeout(timer);
                timer = setTimeout(
                    () => void this.refreshExternalAvailability(),
                    300
                );
            });
            onCleanup(() => {
                clearTimeout(timer);
                subscription.unsubscribe();
                this.availabilityRequest++;
            });
        });
    }

    async refreshExternalAvailability(): Promise<void> {
        const probe = window.electron?.getExternalPlayerAvailability;
        if (!this.canCheckExternalPlayers() || !probe) return;
        const request = ++this.availabilityRequest;
        this.checkingExternalPlayers.set(true);
        const value = this.form().getRawValue();
        try {
            const result = await probe({
                mpv: value.mpvPlayerPath ?? '',
                vlc: value.vlcPlayerPath ?? '',
            });
            if (request === this.availabilityRequest)
                this.externalAvailability.set(result);
        } catch {
            if (request === this.availabilityRequest)
                this.externalAvailability.set({ mpv: null, vlc: null });
        } finally {
            if (request === this.availabilityRequest)
                this.checkingExternalPlayers.set(false);
        }
    }

    externalPlayerStatusKey(): string {
        if (this.checkingExternalPlayers())
            return 'SETTINGS.EXTERNAL_PLAYER_CHECKING';
        const player: VideoPlayer = this.form().value.player;
        const available =
            player === VideoPlayer.MPV || player === VideoPlayer.VLC
                ? this.externalAvailability()[player]
                : null;
        if (available === true) return 'SETTINGS.EXTERNAL_PLAYER_FOUND';
        return available === false
            ? 'SETTINGS.EXTERNAL_PLAYER_INSTALL_HINT'
            : 'SETTINGS.EXTERNAL_PLAYER_UNKNOWN';
    }

    externalPlayerUnavailable(player: VideoPlayer): boolean {
        return (
            (player === VideoPlayer.MPV || player === VideoPlayer.VLC) &&
            this.externalAvailability()[player] === false
        );
    }

    isWebPlayerSelected(): boolean {
        return reportsPlaybackFailures(this.form().value.player);
    }

    /**
     * The fullscreen channel panel lives inside the fullscreen element the
     * shared controls own (the player view host). The legacy vendor chrome
     * fullscreens the engine's own element and external MPV/VLC own their
     * own window, so in both cases the toggle would control nothing.
     * Embedded MPV always renders the shared controls.
     */
    supportsFullscreenChannelPanel(): boolean {
        const value = this.form().value;
        return (
            (this.isWebPlayerSelected() &&
                value.webPlayerSharedControls !== false) ||
            value.player === VideoPlayer.EmbeddedMpv
        );
    }

    /**
     * The Up next card is part of the shared controls. Embedded MPV mounts
     * them only under the frame-copy engine; the native-view engine keeps
     * its own dock, where the toggle would control nothing.
     */
    supportsUpNextCard(): boolean {
        const value = this.form().value;
        return (
            (this.isWebPlayerSelected() &&
                value.webPlayerSharedControls !== false) ||
            (value.player === VideoPlayer.EmbeddedMpv && this.frameCopyActive())
        );
    }

    isExternalPlayerSelected(): boolean {
        const player = this.form().value.player;
        return player === VideoPlayer.MPV || player === VideoPlayer.VLC;
    }

    isEmbeddedMpvSelected(): boolean {
        return this.form().value.player === VideoPlayer.EmbeddedMpv;
    }
}
