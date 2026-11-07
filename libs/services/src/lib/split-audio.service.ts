import { Injectable, signal } from '@angular/core';
import type { Channel, ExternalAudioOverride } from '@iptvnator/shared/interfaces';

/** How long a requested override waits for the playback launch that should use it. */
export const SPLIT_AUDIO_PENDING_TTL_MS = 10_000;
/** mpv accepts any value; this keeps the UI and the saved values sane. */
export const SPLIT_AUDIO_MAX_DELAY_SECONDS = 60;

const DELAY_STORAGE_PREFIX = 'iptvnator.splitAudioDelay.';

/**
 * "Video from channel A, audio from channel B" for the external MPV player.
 *
 * The channel list asks for an override right before it starts playback; the
 * playback launch takes it exactly once. An override nobody took within
 * {@link SPLIT_AUDIO_PENDING_TTL_MS} is dropped, so a stale request can never
 * attach to an unrelated channel later.
 *
 * The delay between the two streams is remembered per (video, audio) pair.
 * Pairs are stored under a hash, so stream URLs (which often carry the
 * provider login) never end up as storage keys.
 */
/** The live channel being watched and the channels its audio can come from. */
export interface SplitAudioContext {
    readonly video: Channel;
    readonly channels: readonly Channel[];
}

@Injectable({ providedIn: 'root' })
export class SplitAudioService {
    /**
     * Set by the channel lists when a live channel starts, so the player's
     * control bar can offer "audio from another channel" for it.
     */
    readonly context = signal<SplitAudioContext | null>(null);

    setContext(context: SplitAudioContext | null): void {
        this.context.set(context);
    }

    private pending: { override: ExternalAudioOverride; at: number } | null =
        null;

    request(override: ExternalAudioOverride, now = Date.now()): void {
        this.pending = {
            override: {
                ...override,
                delaySeconds: this.clampDelay(override.delaySeconds ?? 0),
            },
            at: now,
        };
    }

    /** The pending override, once. Null when none is waiting or it expired. */
    take(now = Date.now()): ExternalAudioOverride | null {
        const pending = this.pending;
        this.pending = null;
        if (!pending || now - pending.at > SPLIT_AUDIO_PENDING_TTL_MS) {
            return null;
        }
        return pending.override;
    }

    clear(): void {
        this.pending = null;
    }

    clampDelay(value: number): number {
        if (!Number.isFinite(value)) {
            return 0;
        }
        return Math.max(
            -SPLIT_AUDIO_MAX_DELAY_SECONDS,
            Math.min(SPLIT_AUDIO_MAX_DELAY_SECONDS, value)
        );
    }

    savedDelay(videoUrl: string, audioUrl: string): number {
        try {
            const raw = localStorage.getItem(
                this.storageKey(videoUrl, audioUrl)
            );
            return raw === null ? 0 : this.clampDelay(Number(raw));
        } catch {
            return 0; // storage can be unavailable; the delay is a convenience
        }
    }

    saveDelay(videoUrl: string, audioUrl: string, delaySeconds: number): void {
        try {
            localStorage.setItem(
                this.storageKey(videoUrl, audioUrl),
                String(this.clampDelay(delaySeconds))
            );
        } catch {
            // see savedDelay
        }
    }

    private storageKey(videoUrl: string, audioUrl: string): string {
        return DELAY_STORAGE_PREFIX + fnv1a(`${videoUrl}\n${audioUrl}`);
    }
}

/** 32-bit FNV-1a, hex. Not security: only keeps URLs out of storage keys. */
function fnv1a(text: string): string {
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}
