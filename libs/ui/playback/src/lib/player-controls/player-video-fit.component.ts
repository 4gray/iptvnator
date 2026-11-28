import { ChangeDetectionStrategy, Component, computed, effect, input, output, signal, untracked } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import { applyVideoFit, videoFitModes, type VideoFitMode } from './video-fit';

@Component({
    selector: 'app-player-video-fit',
    imports: [MatButtonModule, MatIconModule, MatMenuModule, MatTooltipModule, TranslatePipe],
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: { '[class.floating]': 'floating()' },
    template: `
        @if (video() || command()) {
            <button mat-icon-button type="button"
                class="player-controls__button"
                data-test-id="player-controls-video-fit"
                [style.color]="mode() === 'original' ? null : 'var(--pc-accent-violet, #b599ff)'"
                [matMenuTriggerFor]="menu"
                [attr.aria-label]="('PLAYER_VIDEO_FIT.TITLE' | translate) + ': ' + (label() | translate)"
                [attr.aria-pressed]="mode() !== 'original'"
                [matTooltip]="label() | translate"
                (menuOpened)="menuOpen.emit(true)" (menuClosed)="menuOpen.emit(false)">
                <mat-icon>aspect_ratio</mat-icon>
            </button>
            <mat-menu #menu="matMenu">
                @for (option of modes; track option) {
                    <button mat-menu-item role="menuitemradio"
                        [attr.aria-checked]="mode() === option"
                        (click)="mode.set(option)">
                        <mat-icon>{{ mode() === option ? 'radio_button_checked' : 'radio_button_unchecked' }}</mat-icon>
                        <span>{{ ('PLAYER_VIDEO_FIT.' + option.toUpperCase()) | translate }}</span>
                    </button>
                }
            </mat-menu>
        }
    `,
    styles: `
        :host { display: contents; }
        :host.floating { display: block; position: absolute; top: 8px; right: 8px; z-index: 5; background: rgba(12,16,23,.86); }
        button[mat-icon-button] {
            --mat-icon-button-state-layer-size: 40px;
            --mat-icon-button-container-shape: 12px;
            color: var(--pc-text, #e7ecf3);
            app-region: no-drag;
        }
        button:focus-visible { outline: 2px solid var(--pc-text, #e7ecf3); outline-offset: -2px; }
    `,
})
export class PlayerVideoFitComponent {
    readonly surface = input<HTMLElement | null>(null);
    readonly owner = input<HTMLElement | null>(null);
    readonly command = input<((mode: VideoFitMode) => void) | null>(null);
    readonly floating = input(false);
    readonly menuOpen = output<boolean>();
    readonly modes: readonly VideoFitMode[] = ['original', 'crop', 'stretch'];
    readonly mode = signal<VideoFitMode>('original');
    readonly video = signal<HTMLVideoElement | null>(null);
    private readonly pictureInPicture = signal(false);
    readonly label = computed(() => `PLAYER_VIDEO_FIT.${this.mode().toUpperCase()}`);

    constructor() {
        effect((onCleanup) => {
            const surface = this.surface();
            const owner = this.owner() ?? surface;
            this.mode.set(owner ? videoFitModes.get(owner) ?? 'original' : 'original');
            if (!surface) return;
            // Scope to this engine shell, never sibling multiview videos/canvases.
            const sync = () => this.video.set(surface.querySelector('video'));
            sync();
            const observer = new MutationObserver(sync);
            observer.observe(surface, { childList: true, subtree: true });
            onCleanup(() => {
                observer.disconnect();
                this.video.set(null);
            });
        });
        effect((onCleanup) => {
            const owner = this.owner() ?? this.surface();
            const mode = this.mode();
            const video = this.video();
            if (owner) videoFitModes.set(owner, mode);
            const command = this.command();
            if (command) untracked(() => command(mode));
            if (video) onCleanup(applyVideoFit(video, this.pictureInPicture() ? 'original' : mode));
        });
        effect((onCleanup) => {
            const video = this.video();
            if (!video) return;
            const sync = () => this.pictureInPicture.set(document.pictureInPictureElement === video);
            sync();
            video.addEventListener('enterpictureinpicture', sync);
            video.addEventListener('leavepictureinpicture', sync);
            onCleanup(() => {
                video.removeEventListener('enterpictureinpicture', sync);
                video.removeEventListener('leavepictureinpicture', sync);
            });
        });
    }
}
