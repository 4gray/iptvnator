import { Media, Playback, Progress } from '@iptvnator/tv/util';
/** Owns the only native video element. History begins at `playing`, never at intent. */
export class NativePlayer {
    item?: Media;
    lastPlayback?: { sourceId: string; url: string };
    clearDiagnostic() {
        this.lastPlayback = undefined;
    }
    get hasConfirmedPlayback() {
        return this.confirmed && !this.video.paused && !this.video.ended;
    }
    private confirmed = false;
    private timer?: ReturnType<typeof setInterval>;
    private resumePosition = 0;
    private generation = 0;
    private handlers: Record<string, () => void>;
    constructor(
        readonly video: HTMLVideoElement,
        private save: (progress: Progress) => Promise<void>,
        private failure: (message: string) => void,
        private changed: () => void
    ) {
        this.handlers = {
            playing: () => {
                this.confirmed = true;
                this.persist();
                this.changed();
            },
            loadedmetadata: () => {
                if (
                    this.resumePosition > 0 &&
                    Number.isFinite(video.duration)
                ) {
                    video.currentTime = Math.min(
                        this.resumePosition,
                        Math.max(0, video.duration - 1)
                    );
                    this.resumePosition = 0;
                }
            },
            pause: () => {
                this.persist();
                this.changed();
            },
            ended: () => {
                this.persist();
                this.changed();
            },
            error: () => {
                if (this.item)
                    this.failure(
                        'This stream could not be played. Check codec, network and provider media headers. The API backend does not relay video.'
                    );
            },
            timeupdate: () => this.changed(),
        };
        Object.keys(this.handlers).forEach((name) =>
            video.addEventListener(name, this.handlers[name])
        );
        document.addEventListener('visibilitychange', this.visibility);
        window.addEventListener('pagehide', this.visibility);
        this.timer = setInterval(() => this.persist(), 10000);
    }
    private visibility = () => {
        this.persist();
        if (document.hidden) this.video.pause();
    };
    async play(item: Media, playback: Playback, resume: number) {
        this.stop();
        const generation = ++this.generation;
        this.item = item;
        this.lastPlayback = { sourceId: item.sourceId, url: playback.url };
        this.resumePosition = item.kind === 'live' ? 0 : resume;
        this.confirmed = false;
        this.video.src = playback.url;
        this.video.load();
        try {
            await this.video.play();
        } catch (error) {
            const reason =
                error instanceof DOMException ? error.name : 'MediaError';
            if (this.generation === generation)
                this.failure(
                    `Playback did not start (${reason}). Press Play to retry. This stream may need unsupported media headers or codecs.`
                );
        }
        this.changed();
    }
    persist() {
        const item = this.item;
        if (!item || !this.confirmed) return;
        const seconds = Number.isFinite(this.video.currentTime)
            ? this.video.currentTime
            : 0;
        const duration = Number.isFinite(this.video.duration)
            ? this.video.duration
            : 0;
        this.save({ item, seconds, duration, updated: Date.now() }).catch(() =>
            this.failure(
                'Viewing progress could not be saved. Free TV storage and retry.'
            )
        );
    }
    stop() {
        this.persist();
        this.item = undefined;
        this.confirmed = false;
        this.generation++;
        this.video.pause();
        this.video.removeAttribute('src');
        this.video.load();
    }
    resume() {
        this.video
            .play()
            .catch(() => this.failure('Playback could not resume.'));
    }
    pause() {
        this.video.pause();
    }
    toggle() {
        if (this.video.paused) this.resume();
        else this.pause();
    }
    seek(delta: number) {
        if (this.item?.kind !== 'live' && Number.isFinite(this.video.duration))
            this.video.currentTime = Math.max(
                0,
                Math.min(this.video.duration, this.video.currentTime + delta)
            );
    }
    dispose() {
        this.stop();
        clearInterval(this.timer);
        Object.keys(this.handlers).forEach((name) =>
            this.video.removeEventListener(name, this.handlers[name])
        );
        document.removeEventListener('visibilitychange', this.visibility);
        window.removeEventListener('pagehide', this.visibility);
    }
}
