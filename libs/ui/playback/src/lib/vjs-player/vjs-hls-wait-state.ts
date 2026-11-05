import { signal } from '@angular/core';
import type { VideoPlayerSource } from './vjs-player.types';

export const HLS_WAIT_NOTICE_MS = 15_000;

/** A nonterminal notice: VHS keeps its own retries and can recover unaided. */
export class VjsHlsWaitState {
    readonly visible = signal(false);
    private detach: (() => void) | null = null;

    bind(video: HTMLVideoElement, source: VideoPlayerSource | null): void {
        this.clear();
        if (
            !source ||
            !(
                /mpegurl/i.test(source.type ?? '') ||
                /\.m3u8(?:[?#]|$)/i.test(source.src)
            )
        )
            return;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let position = video.currentTime;
        const stop = () => {
            clearTimeout(timer);
            timer = undefined;
            this.visible.set(false);
        };
        const waiting = () => {
            if (
                timer !== undefined ||
                video.paused ||
                video.ended ||
                video.error
            )
                return;
            timer = setTimeout(() => {
                timer = undefined;
                if (
                    !video.paused &&
                    !video.ended &&
                    !video.error &&
                    video.readyState < 3
                ) {
                    this.visible.set(true);
                }
            }, HLS_WAIT_NOTICE_MS);
        };
        const progress = () => {
            if (video.currentTime > position + 0.05) stop();
            position = video.currentTime;
        };
        const events: Record<string, EventListener> = {
            play: waiting,
            waiting,
            stalled: waiting,
            loadstart: waiting,
            playing: stop,
            pause: stop,
            ended: stop,
            error: stop,
            timeupdate: progress,
        };
        for (const [name, listener] of Object.entries(events))
            video.addEventListener(name, listener);
        this.detach = () => {
            for (const [name, listener] of Object.entries(events))
                video.removeEventListener(name, listener);
            stop();
        };
        if (video.readyState < 3) waiting();
    }

    clear(): void {
        this.detach?.();
        this.detach = null;
        this.visible.set(false);
    }
}
