/**
 * How long after a pointer or key interaction inside the tile a media change
 * still counts as the viewer's own action.
 */
const VIEWER_INTERACTION_WINDOW_MS = 1000;

export interface WebPlayerTileMediaOptions {
    /** Element that contains every engine `<video>` of one tile. */
    readonly root: HTMLElement;
    /** The viewer tried to hear this tile: unmuted it or played it (D3). */
    readonly onAudioRequested: () => void;
    readonly now?: () => number;
}

/**
 * Applies the multiview session's `muted` and `paused` state to the
 * `<video>` elements of one tile, whichever web engine renders them and
 * however often it remounts or replaces its element.
 *
 * Tile videos also cannot enter system picture-in-picture.
 *
 * Only restrictive states are enforced on their own: a muted tile stays
 * muted and a held tile stays paused even when an engine unmutes or starts
 * itself. When the viewer does that inside the tile, the tile asks for the
 * audio instead, so the session moves it (R2, R4) rather than two tiles
 * playing sound at once.
 */
export class WebPlayerTileMedia {
    private muted: boolean | null = null;
    private paused: boolean | null = null;
    private lastInteraction = Number.NEGATIVE_INFINITY;
    private readonly videos = new Map<HTMLVideoElement, () => void>();
    private readonly observer: MutationObserver;
    private readonly now: () => number;
    private readonly recordInteraction = (): void => {
        this.lastInteraction = this.now();
    };

    constructor(private readonly options: WebPlayerTileMediaOptions) {
        this.now = options.now ?? (() => Date.now());
        options.root.addEventListener(
            'pointerdown',
            this.recordInteraction,
            true
        );
        options.root.addEventListener('keydown', this.recordInteraction, true);
        this.observer = new MutationObserver(() => this.scan());
        this.observer.observe(options.root, { childList: true, subtree: true });
        this.scan();
    }

    /** null leaves that property to the engine and the viewer. */
    sync(muted: boolean | null, paused: boolean | null): void {
        const unmute = this.muted === true && muted === false;
        const resume = this.paused === true && paused === false;
        this.muted = muted;
        this.paused = paused;
        for (const video of this.videos.keys()) {
            if (unmute) video.muted = false;
            if (resume && video.paused) void playQuietly(video);
            this.enforce(video);
        }
    }

    destroy(): void {
        this.observer.disconnect();
        this.options.root.removeEventListener(
            'pointerdown',
            this.recordInteraction,
            true
        );
        this.options.root.removeEventListener(
            'keydown',
            this.recordInteraction,
            true
        );
        for (const release of this.videos.values()) release();
        this.videos.clear();
    }

    private enforce(video: HTMLVideoElement): void {
        // A multiview tile never pops out on its own (decision D12); the
        // dock's picture-in-picture capability honours this flag.
        if (this.muted !== null || this.paused !== null) {
            video.disablePictureInPicture = true;
        }
        if (this.muted === true && !video.muted) video.muted = true;
        if (this.paused === true && !video.paused) video.pause();
    }

    private scan(): void {
        const present = new Set(this.options.root.querySelectorAll('video'));
        for (const [video, release] of this.videos) {
            if (!present.has(video)) {
                release();
                this.videos.delete(video);
            }
        }
        for (const video of present) {
            if (!this.videos.has(video)) {
                this.videos.set(video, this.watch(video));
                this.enforce(video);
            }
        }
    }

    private watch(video: HTMLVideoElement): () => void {
        const onVolumeChange = (): void => {
            if (this.muted !== true || video.muted) return;
            video.muted = true;
            if (this.byViewer()) this.options.onAudioRequested();
        };
        const onPlay = (): void => {
            if (this.paused !== true) return;
            if (this.byViewer()) this.options.onAudioRequested();
            else video.pause();
        };
        video.addEventListener('volumechange', onVolumeChange);
        video.addEventListener('play', onPlay);
        return () => {
            video.removeEventListener('volumechange', onVolumeChange);
            video.removeEventListener('play', onPlay);
        };
    }

    private byViewer(): boolean {
        return (
            this.now() - this.lastInteraction <= VIEWER_INTERACTION_WINDOW_MS
        );
    }
}

function playQuietly(video: HTMLVideoElement): Promise<void> {
    try {
        return video.play().catch(() => undefined);
    } catch {
        // Some engines replace the element mid-call; the next scan covers it.
        return Promise.resolve();
    }
}
