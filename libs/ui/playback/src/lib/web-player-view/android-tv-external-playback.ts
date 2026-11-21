import {
    DOCUMENT,
    computed,
    effect,
    inject,
    signal,
    type Signal,
} from '@angular/core';
import type { PlaybackDiagnostic } from '@iptvnator/playback/util';
import { createRandomId, type ResolvedPortalPlayback } from '@iptvnator/shared/interfaces';
import { ParentalLockService } from '@iptvnator/services';

// Match the Android bridge and intent limits.
const MAX_BRIDGE_MESSAGE_LENGTH = 64 * 1024;
const MAX_EXTERNAL_TITLE_LENGTH = 256;

export class AndroidTvExternalPlayback {
    private readonly window = inject(DOCUMENT).defaultView as
        (Window & { TvShell?: { postMessage(message: string): void } }) | null;
    private readonly bridge = this.window?.TvShell;
    private readonly parentalLock = this.bridge
        ? inject(ParentalLockService)
        : null;
    private readonly checkedUrl = signal<string | null>(null);
    private readonly url = computed(() => {
        if (!this.diagnostic() || this.parentalLock?.enabled()) return null;
        const playback = this.playback();
        if (playback.drm || playback.requiresFreshStreamUrl) return null;
        try {
            const url = new URL(playback.streamUrl);
            return (url.protocol === 'http:' || url.protocol === 'https:') &&
                !url.username &&
                !url.password
                ? url.href
                : null;
        } catch {
            return null;
        }
    });
    readonly available = computed(() => {
        const url = this.url();
        return url !== null && url === this.checkedUrl();
    });

    constructor(
        private readonly playback: Signal<ResolvedPortalPlayback>,
        private readonly diagnostic: Signal<PlaybackDiagnostic | null>
    ) {
        const window = this.window;
        const bridge = this.bridge;
        if (typeof bridge?.postMessage !== 'function' || !window) return;
        effect((onCleanup) => {
            const url = this.url();
            this.checkedUrl.set(null);
            if (!url) return;
            let id: string;
            const check = () => {
                id = createRandomId();
                this.send(JSON.stringify(['checkExternalPlayback', id, url]));
            };
            const receive = (event: Event) => {
                if (event instanceof CustomEvent && event.detail?.id === id) {
                    this.checkedUrl.set(
                        event.detail.available === true ? url : null
                    );
                }
            };
            window.addEventListener(
                'iptvnator:android-external-playback',
                receive
            );
            window.addEventListener(
                'iptvnator:android-playback-availability',
                check
            );
            onCleanup(() => {
                window.removeEventListener(
                    'iptvnator:android-external-playback',
                    receive
                );
                window.removeEventListener(
                    'iptvnator:android-playback-availability',
                    check
                );
            });
            check();
        });
    }

    private send(message: string): void {
        if (message.length > MAX_BRIDGE_MESSAGE_LENGTH) return;
        try {
            this.bridge?.postMessage(message);
        } catch {
            this.checkedUrl.set(null);
        }
    }

    choose(): void {
        if (!this.available()) return;
        const command = 'chooseExternalPlayback';
        const url = this.url();
        const title =
            this.playback().title?.slice(0, MAX_EXTERNAL_TITLE_LENGTH) ?? '';
        const message = JSON.stringify([command, url, title]);
        this.send(
            message.length <= MAX_BRIDGE_MESSAGE_LENGTH
                ? message
                : JSON.stringify([command, url, ''])
        );
    }
}
