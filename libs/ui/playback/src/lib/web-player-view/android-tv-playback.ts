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
import { activePersonalScope } from '@iptvnator/services/profiles';
import {
    createRandomId,
    type ResolvedPortalPlayback,
} from '@iptvnator/shared/interfaces';
import type { PlayerTimeUpdate } from '../playback-history/player-time-update';
import {
    persistVolume,
    readLastAudibleVolume,
    rememberAudibleVolume,
    readStoredVolume,
} from '../player-controls/controls-format.utils';
import { readVideoVolume } from '../player-controls/web-video-controls.media-helpers';

type PlaybackResult = {
    readonly positionMs: number;
    readonly durationMs: number;
    readonly playedMs: number;
    readonly savedAt?: number;
    readonly started?: boolean;
    readonly ended?: boolean;
    readonly failed?: boolean;
};

type AndroidWindow = Window & {
    TvShell?: { postMessage(message: string): void };
    iptvnatorAndroidPlaybackEnabled?: boolean;
};

function isSmoothStreamingPath(pathname: string): boolean {
    return /\.ism[l]?(?:\/|$)/i.test(pathname);
}

function isHlsManifest(pathname: string, extension: string): boolean {
    // IIS Media Services and Azure Media Services can serve HLS from this path.
    return (
        extension === 'm3u8' ||
        extension === 'm3u' ||
        /\.isml?\/manifest\((?:[^,()]+,)*format=m3u8-aapl(?:-v3)?(?:,[^,()]+)*\)$/i.test(
            pathname
        )
    );
}

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
        readonly audibleVolume: number;
        readonly reportFailure: () => void;
        readonly failed?: boolean;
    } | null>(null);

    private readonly enabled = signal(
        this.window?.iptvnatorAndroidPlaybackEnabled === true
    );
    private readonly continuedAttempt = signal<{
        token: symbol;
        attempt: string;
    } | null>(null);
    readonly attempt = computed(() => {
        if (!this.window?.TvShell?.postMessage) return null;
        const token = this.currentToken();
        const continued = this.continuedAttempt();
        return continued?.token === token
            ? continued.attempt
            : createRandomId();
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
        private readonly onEnded: () => void,
        private readonly reloadWeb: () => void,
        private readonly waitForActivity?: (
            sessionId: string | undefined
        ) => Promise<void> | undefined
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
            const enabled = window.iptvnatorAndroidPlaybackEnabled === true;
            this.enabled.set(enabled);
            if (!enabled && this.ownedSession()) this.returnToWeb();
        };
        const result = (event: Event) => {
            if (!(event instanceof CustomEvent)) return;
            const session = this.ownedSession();
            if (!session?.pending || event.detail?.id !== session.id) return;
            const { id } = session;
            const data = event.detail.result as PlaybackResult | null;
            if (!data) {
                this.resumeWeb();
                return;
            }
            this.session.set({
                ...session,
                pending: false,
                failed: data.failed,
            });
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
                            ...(data.savedAt &&
                            Number.isSafeInteger(data.savedAt) &&
                            data.savedAt > 0 &&
                            data.savedAt <= 8_640_000_000_000_000
                                ? {
                                      nativeCheckpointAt: new Date(
                                          data.savedAt
                                      ).toISOString(),
                                  }
                                : {}),
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
            this.session.set(null);
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
            !this.enabled() ||
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
            const path = decodeURIComponent(pathname.replace(/\/+$/, ''));
            return (
                !username &&
                !password &&
                !path.toLowerCase().endsWith('.mpd') &&
                (!isSmoothStreamingPath(path) ||
                    isHlsManifest(
                        path,
                        getPlaybackMediaExtensionFromUrl(playback.streamUrl)
                    ))
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
        const window = this.window;
        const bridge = window?.TvShell;
        if (!window || !bridge || !this.canOpen(playback) || this.pending())
            return;
        const video = surface.querySelector('video');
        const previous = this.ownedSession();
        const volume = video
            ? readVideoVolume(video)
            : (previous?.volume ?? readStoredVolume());
        const audibleVolume =
            video?.volume ||
            previous?.audibleVolume ||
            readLastAudibleVolume() ||
            0.5;
        const id = createRandomId();
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
            audibleVolume,
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
            async () => {
                if (this.ownedSession()?.id !== id) return;
                try {
                    const beginning = this.waitForActivity?.(
                        contentInfo?.activitySessionId
                    );
                    if (beginning) await beginning;
                    if (
                        this.ownedSession()?.id !== id ||
                        this.parentalLock?.enabled()
                    )
                        return;
                    const message = JSON.stringify([
                        'playNative',
                        id,
                        {
                            url: playback.streamUrl,
                            hls: isHlsManifest(
                                decodeURIComponent(
                                    new URL(playback.streamUrl).pathname
                                ),
                                extension
                            ),
                            live,
                            startTime,
                            headers,
                            captions,
                            volume,
                            audibleVolume,
                            // Only resume metadata crosses this bridge alongside the stream request.
                            checkpoint: contentInfo && {
                                profile,
                                // The Default's launches stay byte-identical: no scope is sent.
                                ...(activePersonalScope() === 'shared'
                                    ? {}
                                    : { personalScope: activePersonalScope() }),
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
                        this.resumeWeb();
                        return;
                    }
                    window.iptvnatorAndroidCheckpointRequestId = id;
                    bridge.postMessage(message);
                } catch {
                    if (this.ownedSession()?.id === id) this.resumeWeb();
                }
            },
            { injector: this.injector }
        );
    }

    returnToWeb(): void {
        const session = this.ownedSession();
        const attempt = session?.failed ? this.attempt() : null;
        this.resumeWeb(session?.pending ? session.id : undefined);
        if (attempt) {
            this.continuedAttempt.set({ token: this.currentToken(), attempt });
        }
    }

    private resumeWeb(cancelId?: string): void {
        this.restoreWebVolume();
        if (cancelId) this.cancel(cancelId);
        this.reloadWeb();
    }

    restoreWebVolume(): void {
        const session = this.ownedSession();
        this.session.set(null);
        if (session) {
            // Shared controls read the persisted volume when they attach to the new engine.
            try {
                persistVolume(session.volume);
            } catch {
                // The engine input still preserves the volume when storage is unavailable.
            }
            rememberAudibleVolume(session.audibleVolume);
            this.webVolume.set(session.volume);
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
