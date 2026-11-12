import {
    DOCUMENT,
    DestroyRef,
    Injector,
    afterNextRender,
    computed,
    inject,
    signal,
} from '@angular/core';
import { getPlaybackMediaExtensionFromUrl } from '@iptvnator/playback/util';
import type { ResolvedPortalPlayback } from '@iptvnator/shared/interfaces';
import { PLAYBACK_CONFIRMATION_SECONDS } from '../playback-history/playback-progress-confirmation';
import type { PlayerTimeUpdate } from '../playback-history/player-time-update';

type PlaybackLabels = { readonly open: string; readonly back: string };
type PlaybackResult = {
    readonly positionMs: number;
    readonly durationMs: number;
    readonly playedMs: number;
};

type AndroidWindow = Window & {
    TvShell?: { postMessage(message: string): void };
    iptvnatorAndroidPlaybackLabels?: PlaybackLabels | null;
};

export class AndroidTvPlayback {
    private readonly window = inject(DOCUMENT)
        .defaultView as AndroidWindow | null;
    private readonly injector = inject(Injector);
    private readonly session = signal<{
        readonly id: string;
        readonly owner: string;
        readonly token: symbol;
        readonly pending: boolean;
    } | null>(null);

    readonly labels = signal(
        this.window?.iptvnatorAndroidPlaybackLabels ?? null
    );
    readonly suspended = computed(() => this.ownedSession() !== null);
    readonly pending = computed(() => this.ownedSession()?.pending ?? false);

    constructor(
        private readonly currentOwner: () => string,
        private readonly currentToken: () => symbol,
        private readonly onWatched: () => void,
        private readonly onPosition: (position: PlayerTimeUpdate) => void
    ) {
        const window = this.window;
        if (!window?.TvShell?.postMessage) return;
        const availability = () => {
            const labels = window.iptvnatorAndroidPlaybackLabels ?? null;
            this.labels.set(labels);
            if (!labels) this.returnToWeb();
        };
        const result = (event: Event) => {
            if (!(event instanceof CustomEvent)) return;
            const session = this.ownedSession();
            if (!session?.pending || event.detail?.id !== session.id) return;
            const data = event.detail.result as PlaybackResult | null;
            if (!data) {
                this.session.set(null);
                return;
            }
            this.session.set({ ...session, pending: false });
            if (
                Number.isSafeInteger(data.positionMs) &&
                Number.isSafeInteger(data.durationMs) &&
                Number.isSafeInteger(data.playedMs) &&
                data.positionMs >= 0 &&
                data.durationMs >= data.positionMs &&
                data.playedMs >= PLAYBACK_CONFIRMATION_SECONDS * 1000
            ) {
                this.onWatched();
                if (data.durationMs > 0) {
                    this.onPosition({
                        currentTime: data.positionMs / 1000,
                        duration: data.durationMs / 1000,
                        playing: false,
                        checkpoint: true,
                    });
                }
            }
        };
        window.addEventListener(
            'iptvnator:android-playback-availability',
            availability
        );
        window.addEventListener('iptvnator:android-playback-result', result);
        inject(DestroyRef).onDestroy(() => {
            window.removeEventListener(
                'iptvnator:android-playback-availability',
                availability
            );
            window.removeEventListener(
                'iptvnator:android-playback-result',
                result
            );
        });
    }

    canOpen(playback: ResolvedPortalPlayback): boolean {
        return (
            this.labels() !== null &&
            typeof this.window?.TvShell?.postMessage === 'function' &&
            !playback.drm &&
            /^https?:\/\//i.test(playback.streamUrl) &&
            getPlaybackMediaExtensionFromUrl(playback.streamUrl) !== 'mpd'
        );
    }

    open(
        playback: ResolvedPortalPlayback,
        live: boolean,
        startTime: number,
        captions: boolean
    ): void {
        const bridge = this.window?.TvShell;
        if (!bridge || !this.canOpen(playback) || this.pending()) return;
        const id = crypto.randomUUID();
        this.session.set({
            id,
            owner: this.currentOwner(),
            token: this.currentToken(),
            pending: true,
        });
        const extension = getPlaybackMediaExtensionFromUrl(playback.streamUrl);
        const headers = { ...playback.headers };
        for (const [key, value] of [
            ['user-agent', playback.userAgent],
            ['referer', playback.referer],
            ['origin', playback.origin],
        ] as const) {
            if (
                value &&
                !Object.keys(headers).some((name) => name.toLowerCase() === key)
            ) {
                headers[key] = value;
            }
        }
        // Let Angular destroy the previous engine before the provider sees a new request.
        afterNextRender(
            () => {
                if (this.ownedSession()?.id !== id) return;
                try {
                    const message = JSON.stringify([
                        'playNative',
                        id,
                        {
                            url: playback.streamUrl,
                            hls: extension === 'm3u8' || extension === 'm3u',
                            live,
                            startTime,
                            headers,
                            captions,
                        },
                    ]);
                    if (message.length > 64 * 1024) {
                        this.returnToWeb();
                        return;
                    }
                    bridge.postMessage(message);
                } catch {
                    this.session.set(null);
                }
            },
            { injector: this.injector }
        );
    }

    returnToWeb(): void {
        this.session.set(null);
    }

    private ownedSession() {
        const session = this.session();
        return session?.token === this.currentToken() &&
            session.owner === this.currentOwner()
            ? session
            : null;
    }
}
