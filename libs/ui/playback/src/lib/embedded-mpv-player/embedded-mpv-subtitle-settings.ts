import { signal } from '@angular/core';
import type { PlayerSubtitleStyle } from '../player-controls/player-controls.model';
import {
    clampSubtitleDelay,
    isDefaultSubtitleStyle,
    normalizeSubtitleStyle,
    persistSubtitleStyle,
    readStoredSubtitleStyle,
} from '../player-controls/subtitle-style';
import type { EmbeddedMpvSessionController } from './embedded-mpv-session-controller';

/**
 * Renderer-side owner of the Embedded MPV subtitle delay and style. mpv does
 * not report `sub-delay`/`sub-scale`/`sub-color` back through the session
 * snapshot, so this class keeps the authoritative optimistic values: delay is
 * per-session (it corrects one stream) and resets when the session changes,
 * while the style is the shared persisted preference and is re-applied to
 * every new session.
 */
export class EmbeddedMpvSubtitleSettings {
    readonly delaySeconds = signal(0);
    readonly style = signal<PlayerSubtitleStyle>(readStoredSubtitleStyle());

    private appliedSessionId: string | null = null;

    constructor(private readonly controller: EmbeddedMpvSessionController) {}

    /** Called from an effect whenever the active session id changes. */
    syncSession(sessionId: string | null): void {
        if (sessionId === this.appliedSessionId) {
            return;
        }
        this.appliedSessionId = sessionId;
        this.delaySeconds.set(0);
        if (sessionId && !isDefaultSubtitleStyle(this.style())) {
            void this.controller.setSubtitleStyle(this.style());
        }
    }

    setDelay(seconds: number): void {
        const clamped = clampSubtitleDelay(seconds);
        this.delaySeconds.set(clamped);
        void this.controller.setSubtitleDelay(clamped);
    }

    setStyle(style: PlayerSubtitleStyle): void {
        const normalized = normalizeSubtitleStyle(style);
        this.style.set(normalized);
        persistSubtitleStyle(normalized);
        void this.controller.setSubtitleStyle(normalized);
    }

    addExternalSubtitle(): void {
        void this.controller.addExternalSubtitle();
    }
}
