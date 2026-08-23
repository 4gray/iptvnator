import type { PlayerSubtitleStyle } from '../player-controls/player-controls.model';
import {
    isDefaultSubtitleStyle,
    normalizeSubtitleStyle,
    persistSubtitleStyle,
    readStoredSubtitleStyle,
} from '../player-controls/subtitle-style';

let nextStyleScopeId = 0;

/**
 * Applies the shared subtitle style (size/color) to a web engine's native cue
 * rendering through a scoped `::cue` rule. Native `TextTrack` cues — embedded
 * tracks, hls.js-managed tracks, and user-loaded external files — all render
 * through the browser's cue display, so one rule covers every source kind.
 *
 * The style is read from and persisted to the shared localStorage preference,
 * so it survives sessions and is shared with the Embedded MPV engine.
 */
export class WebVideoSubtitleStyle {
    private style: PlayerSubtitleStyle = readStoredSubtitleStyle();
    private styleElement: HTMLStyleElement | null = null;
    private video: HTMLVideoElement | null = null;
    private readonly scopeClass = `iptv-subtitle-style-${nextStyleScopeId++}`;

    attach(video: HTMLVideoElement): void {
        if (this.video === video) {
            return;
        }
        this.video?.classList.remove(this.scopeClass);
        this.video = video;
        video.classList.add(this.scopeClass);
        this.applyCss();
    }

    current(): PlayerSubtitleStyle {
        return this.style;
    }

    set(style: PlayerSubtitleStyle): void {
        this.style = normalizeSubtitleStyle(style);
        persistSubtitleStyle(this.style);
        this.applyCss();
    }

    destroy(): void {
        this.video?.classList.remove(this.scopeClass);
        this.video = null;
        this.styleElement?.remove();
        this.styleElement = null;
    }

    private applyCss(): void {
        const video = this.video;
        if (!video) {
            return;
        }

        if (isDefaultSubtitleStyle(this.style)) {
            this.styleElement?.remove();
            this.styleElement = null;
            return;
        }

        const declarations: string[] = [];
        if (this.style.sizePercent !== 100) {
            // Percentage resolves against the browser's video-size-derived
            // default cue font size, so it scales with the player box.
            declarations.push(`font-size: ${this.style.sizePercent}%`);
        }
        if (this.style.color) {
            declarations.push(`color: ${this.style.color}`);
        }

        const doc = video.ownerDocument;
        if (!this.styleElement || !this.styleElement.isConnected) {
            this.styleElement?.remove();
            this.styleElement = doc.createElement('style');
            doc.head.appendChild(this.styleElement);
        }
        this.styleElement.textContent = `.${this.scopeClass}::cue { ${declarations.join('; ')}; }`;
    }
}
