import {
    DOCUMENT,
    DestroyRef,
    Injector,
    afterNextRender,
    computed,
    effect,
    inject,
    linkedSignal,
    signal,
    type WritableSignal,
} from '@angular/core';
import { getPlaybackMediaExtensionFromUrl } from '@iptvnator/playback/util';
import { ParentalLockService } from '@iptvnator/services';
import { sourceProfileName } from '@iptvnator/services/source-sync/connection';
import type { ResolvedPortalPlayback } from '@iptvnator/shared/interfaces';
import type { PlayerTimeUpdate } from '../playback-history/player-time-update';
import {
    persistVolume,
    readStoredVolume,
} from '../player-controls/controls-format.utils';
import { readVideoVolume } from '../player-controls/web-video-controls.media-helpers';

type PlaybackLabels = { readonly open: string; readonly back: string };
type PlaybackResult = {
    readonly positionMs: number;
    readonly durationMs: number;
    readonly playedMs: number;
    readonly started?: boolean;
    readonly ended?: boolean;
    readonly failed?: boolean;
};

type AndroidWindow = Window & {
    TvShell?: { postMessage(message: string): void };
    iptvnatorAndroidPlaybackLabels?: PlaybackLabels | null;
};

export class AndroidTvPlayback {
    private readonly window = inject(DOCUMENT)
        .defaultView as AndroidWindow | null;
    private readonly injector = inject(Injector);
    private readonly parentalLock = this.window?.TvShell?.postMessage
        ? inject(ParentalLockService)
        : null;
    private readonly session = signal<{
        readonly id: string;
        readonly owner: string;
        readonly profile: string;
        readonly token: symbol;
        readonly pending: boolean;
        readonly live: boolean;
        readonly volume: number;
        readonly reportFailure: () => void;
    } | null>(null);

    readonly labels = signal(
        this.window?.iptvnatorAndroidPlaybackLabels ?? null
    );
    readonly attempt = computed(() => {
        if (!this.labels()) return null;
        this.currentToken();
        return crypto.randomUUID();
    });
    readonly suspended = computed(() => this.ownedSession() !== null);
    readonly pending = computed(() => this.ownedSession()?.pending ?? false);
    readonly webVolume: WritableSignal<number>;

    constructor(
        private readonly currentOwner: () => string,
        private readonly currentToken: () => symbol,
        volume: () => number,
        private readonly onStarted: (
            playedSeconds: number,
            confirm: boolean
        ) => void,
        private readonly onPosition: (
            position: PlayerTimeUpdate,
            replayTime: number
        ) => void,
        private readonly onEnded: () => void
    ) {
        this.webVolume = linkedSignal({
            source: () => [this.currentOwner(), volume()],
            computation: () => volume(),
        });
        const window = this.window;
        if (!window?.TvShell?.postMessage) return;
        effect(() => {
            const session = this.session();
            if (
                session?.pending &&
                (!this.ownedSession() || this.parentalLock?.enabled())
            ) {
                this.cancel(session.id);
                this.session.set(null);
            }
        });
        const availability = () => {
            const labels = window.iptvnatorAndroidPlaybackLabels ?? null;
            this.labels.set(labels);
            if (!labels) this.restoreWebVolume();
        };
        const result = (event: Event) => {
            if (!(event instanceof CustomEvent)) return;
            const session = this.ownedSession();
            if (!session?.pending || event.detail?.id !== session.id) return;
            const { id } = session;
            const data = event.detail.result as PlaybackResult | null;
            if (!data) {
                this.restoreWebVolume();
                return;
            }
            this.session.set({ ...session, pending: false });
            if (data.failed) session.reportFailure();
            if (
                Number.isSafeInteger(data.positionMs) &&
                Number.isSafeInteger(data.durationMs) &&
                data.positionMs >= 0 &&
                (data.durationMs === 0 || data.durationMs >= data.positionMs)
            ) {
                const played = Number.isSafeInteger(data.playedMs)
                    ? Math.max(0, data.playedMs) / 1000
                    : 0;
                if (played > 0 || data.started === true)
                    this.onStarted(played, !session.live);
                if (this.ownedSession()?.id !== id) return;
                if (data.durationMs > 0 || data.positionMs > 0) {
                    const currentTime = data.positionMs / 1000;
                    this.onPosition(
                        {
                            currentTime,
                            duration: data.durationMs / 1000,
                            playing: false,
                            checkpoint: true,
                        },
                        data.ended === true ? 0 : currentTime
                    );
                }
            }
            if (
                (session.live || data.ended === true) &&
                this.ownedSession()?.id === id
            ) {
                this.onEnded();
            }
        };
        window.addEventListener(
            'iptvnator:android-playback-availability',
            availability
        );
        window.addEventListener('iptvnator:android-playback-result', result);
        inject(DestroyRef).onDestroy(() => {
            const session = this.session();
            if (session?.pending) this.cancel(session.id);
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
        if (
            this.labels() === null ||
            typeof this.window?.TvShell?.postMessage !== 'function' ||
            this.parentalLock?.enabled() ||
            playback.requiresFreshStreamUrl ||
            playback.drm ||
            !/^https?:\/\//i.test(playback.streamUrl) ||
            getPlaybackMediaExtensionFromUrl(playback.streamUrl) === 'mpd'
        )
            return false;
        try {
            const { pathname, username, password } = new URL(
                playback.streamUrl
            );
            return (
                !username && !password && !/\.ism[l]?(?:\/|$)/i.test(pathname)
            );
        } catch {
            return false;
        }
    }

    open(
        playback: ResolvedPortalPlayback,
        live: boolean,
        startTime: number,
        captions: boolean,
        surface: HTMLElement
    ): void {
        const bridge = this.window?.TvShell;
        if (!bridge || !this.canOpen(playback) || this.pending()) return;
        const video = surface.querySelector('video');
        const volume = video
            ? readVideoVolume(video)
            : (this.ownedSession()?.volume ?? readStoredVolume());
        const id = crypto.randomUUID();
        const profile = sourceProfileName();
        const attempt = this.attempt();
        this.session.set({
            id,
            owner: this.currentOwner(),
            profile,
            token: this.currentToken(),
            pending: true,
            live,
            volume,
            reportFailure: () =>
                surface.dispatchEvent(
                    new CustomEvent('iptvnator:android-playback-failed', {
                        bubbles: true,
                        detail: {
                            attempt,
                            url: playback.streamUrl,
                            title: playback.title,
                        },
                    })
                ),
        });
        const extension = getPlaybackMediaExtensionFromUrl(playback.streamUrl);
        const contentInfo = live ? undefined : playback.contentInfo;
        const headers = { ...playback.headers };
        for (const [key, value] of [
            ['user-agent', playback.userAgent],
            ['referer', playback.referer],
            ['origin', playback.origin],
        ] as const) {
            if (value === undefined) continue;
            for (const name of Object.keys(headers)) {
                if (name.toLowerCase() === key) delete headers[name];
            }
            headers[key] = value;
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
                            volume,
                            // Only resume metadata crosses this bridge alongside the stream request.
                            checkpoint: contentInfo && {
                                profile,
                                playlistId: contentInfo.playlistId,
                                contentXtreamId: contentInfo.contentXtreamId,
                                contentType: contentInfo.contentType,
                                seriesXtreamId: contentInfo.seriesXtreamId,
                                seasonNumber: contentInfo.seasonNumber,
                                seasonGroup:
                                    contentInfo.nativeCheckpointSeasonGroup,
                                episodeNumber: contentInfo.episodeNumber,
                                activitySessionId:
                                    contentInfo.activitySessionId,
                                activityIdentity: contentInfo.activityIdentity,
                            },
                        },
                    ]);
                    if (message.length > 64 * 1024) {
                        this.restoreWebVolume();
                        return;
                    }
                    bridge.postMessage(message);
                } catch {
                    this.restoreWebVolume();
                }
            },
            { injector: this.injector }
        );
    }

    restoreWebVolume(): void {
        const volume = this.ownedSession()?.volume;
        this.session.set(null);
        if (volume !== undefined) {
            // Shared controls read the persisted volume when they attach to the new engine.
            try {
                persistVolume(volume);
            } catch {
                // The engine input still preserves the volume when storage is unavailable.
            }
            this.webVolume.set(volume);
        }
    }

    private cancel(id: string): void {
        try {
            this.window?.TvShell?.postMessage(
                JSON.stringify(['stopNative', id])
            );
        } catch {
            // A destroyed document may have already lost access to its bridge.
        }
    }

    private ownedSession() {
        const session = this.session();
        return session?.token === this.currentToken() &&
            session.owner === this.currentOwner() &&
            session.profile === sourceProfileName()
            ? session
            : null;
    }
}
