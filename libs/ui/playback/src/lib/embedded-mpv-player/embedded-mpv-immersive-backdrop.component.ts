import {
    ChangeDetectionStrategy,
    Component,
    computed,
    inject,
} from '@angular/core';
import { EmbeddedMpvImmersiveService } from './embedded-mpv-immersive.service';

/**
 * Single global backdrop for the immersive embedded-MPV overlay.
 *
 * The native MPV video composites BELOW the WebContents (macOS, transparent
 * window), so the app shell is made transparent over the player region. Instead
 * of repainting every per-route panel opaque (fragile), this renders ONE opaque
 * field with a transparent hole at the native video rect: the surround stays
 * opaque (so the app reads normally) and the hole reveals the native video.
 *
 * The opaque field is drawn with the box-shadow "spotlight" technique — a
 * transparent cutout div casts a `--app-content-bg` shadow that floods the rest
 * of the viewport. Rect + visibility are owned by {@link
 * EmbeddedMpvImmersiveService}; this component is pure presentation. In
 * fullscreen the chrome-hide mechanism takes over, so the backdrop is off.
 */
@Component({
    selector: 'app-embedded-mpv-immersive-backdrop',
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        @if (cutout(); as rect) {
            <div
                class="cutout"
                [style.top.px]="rect.y"
                [style.left.px]="rect.x"
                [style.width.px]="rect.width"
                [style.height.px]="rect.height"
            ></div>
        }
    `,
    styles: [
        `
            :host {
                position: fixed;
                inset: 0;
                pointer-events: none;
                z-index: 0;
                background: transparent;
            }

            .cutout {
                position: absolute;
                background: transparent;
                border-radius: 14px;
                box-shadow: 0 0 0 100vmax var(--app-content-bg);
                pointer-events: none;
            }
        `,
    ],
})
export class EmbeddedMpvImmersiveBackdropComponent {
    private readonly immersive = inject(EmbeddedMpvImmersiveService);

    /**
     * The hole rect, or null when the backdrop should not render: only while
     * active, not fullscreen, and a measured rect exists.
     */
    readonly cutout = computed(() => {
        if (!this.immersive.active() || this.immersive.fullscreen()) {
            return null;
        }
        return this.immersive.rect();
    });
}
