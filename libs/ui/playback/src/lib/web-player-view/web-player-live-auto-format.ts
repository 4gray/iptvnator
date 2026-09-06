import {
    afterNextRender,
    computed,
    linkedSignal,
    type AfterRenderRef,
    type Injector,
    type Signal,
} from '@angular/core';
import {
    type PlaybackDiagnostic,
    resolvePlaybackUrlSourceKind,
} from '@iptvnator/playback/util';
import {
    type ResolvedPortalPlayback,
    VideoPlayer,
} from '@iptvnator/shared/interfaces';

/** One source-format attempt per mounted logical live session, never an engine switch. */
export class WebPlayerLiveAutoFormat {
    private callback?: AfterRenderRef;
    private destroyed = false;
    // Metadata refreshes reuse the transport revision. The returned ownership
    // value is opaque; URLs/headers remain solely in the canonical source input.
    private readonly origin = linkedSignal({
        source: () => this.deps.playback(),
        computation: (
            source,
            previous?: { source: ResolvedPortalPlayback | null; value: symbol }
        ) =>
            previous && sameLiveTransport(source, previous.source)
                ? previous.value
                : Symbol(),
    });
    private readonly intent = computed(() => {
        void this.deps.intent();
        void this.deps.player();
        void this.deps.autoEnabled();
        return Symbol();
    });
    private readonly state = linkedSignal({
        source: () => ({ key: this.deps.sessionKey(), origin: this.origin() }),
        computation: (
            source,
            previous?: {
                source: { key: string; origin: symbol };
                value: {
                    attempted: boolean;
                    started: boolean;
                    pending: boolean;
                    useTs: boolean;
                };
            }
        ) => ({
            attempted:
                previous?.source.key === source.key &&
                !!previous.value.attempted,
            started:
                previous?.source.key === source.key && !!previous.value.started,
            pending: false,
            useTs: false,
        }),
    });
    readonly pending = computed(() => this.state().pending);
    private readonly useTs = computed(() => this.state().useTs);
    readonly playback = computed(() => {
        const playback = this.deps.playback();
        return this.useTs() && playback?.liveAutoTsUrl
            ? {
                  ...playback,
                  streamUrl: playback.liveAutoTsUrl,
                  liveAutoTsUrl: undefined,
              }
            : playback;
    });

    constructor(
        private readonly deps: {
            playback: Signal<ResolvedPortalPlayback | null>;
            sessionKey: Signal<string>;
            player: Signal<VideoPlayer>;
            intent: () => unknown;
            autoEnabled: () => boolean;
            injector: Injector;
        }
    ) {}

    started(): void {
        this.state.update((state) => ({ ...state, started: true }));
    }

    tryFallback(issue: PlaybackDiagnostic): boolean {
        const source = this.deps.playback();
        const state = this.state();
        const status = issue.httpStatus;
        if (
            this.destroyed ||
            !this.deps.autoEnabled() ||
            state.attempted ||
            state.started ||
            !this.deps.sessionKey() ||
            !source?.liveAutoTsUrl ||
            source.isLive !== true ||
            source.contentInfo ||
            source.drm ||
            this.deps.player() === VideoPlayer.EmbeddedMpv ||
            resolvePlaybackUrlSourceKind(source.streamUrl) !== 'hls' ||
            resolvePlaybackUrlSourceKind(source.liveAutoTsUrl) !== 'mpegts' ||
            issue.code !== 'network-error' ||
            status === undefined ||
            status < 400 ||
            status > 599 ||
            // Key/license requests must never cause a format downgrade.
            (issue.hls &&
                !['manifest', 'level', 'segment'].includes(issue.hls.stage))
        )
            return false;
        this.state.set({ ...state, attempted: true, pending: true });
        const origin = this.origin();
        const key = this.deps.sessionKey();
        const intent = this.intent();
        this.callback?.destroy();
        // Render an empty application first. All web transports synchronously destroy
        // their loaders in ngOnDestroy before the TS header handoff may start.
        this.callback = afterNextRender(
            () => {
                this.callback = undefined;
                if (
                    this.destroyed ||
                    origin !== this.origin() ||
                    key !== this.deps.sessionKey()
                )
                    return;
                this.state.update((current) => ({
                    ...current,
                    pending: false,
                    useTs: intent === this.intent(),
                }));
            },
            { injector: this.deps.injector }
        );
        return true;
    }

    destroy(): void {
        this.destroyed = true;
        this.callback?.destroy();
        this.callback = undefined;
    }
}

function sameLiveTransport(
    a: ResolvedPortalPlayback | null,
    b: ResolvedPortalPlayback | null
): boolean {
    if (!a || !b) return a === b;
    const headerKeys = new Set([
        ...Object.keys(a.headers ?? {}),
        ...Object.keys(b.headers ?? {}),
    ]);
    return (
        a.streamUrl === b.streamUrl &&
        a.liveAutoTsUrl === b.liveAutoTsUrl &&
        a.isLive === b.isLive &&
        a.drm === b.drm &&
        a.contentInfo === b.contentInfo &&
        a.userAgent === b.userAgent &&
        a.referer === b.referer &&
        a.origin === b.origin &&
        [...headerKeys].every((key) => a.headers?.[key] === b.headers?.[key])
    );
}
