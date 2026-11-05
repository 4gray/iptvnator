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
    get restoringPosition() {
        return !!this.restore && !this.restore.failed;
    }
    private confirmed = false;
    private timer?: ReturnType<typeof setInterval>;
    private restore?: {
        target: number;
        deadline: number;
        lastAttempt: number;
        attempted: boolean;
        failed: boolean;
    };
    private restoreTimer?: ReturnType<typeof setInterval>;
    private generation = 0;
    private handlers: Record<string, () => void>;
    constructor(
        readonly video: HTMLVideoElement,
        private save: (progress: Progress) => Promise<void>,
        private failure: (message: string) => void,
        private changed: () => void,
        private saveFailure: (
            message: string,
            retry: () => Promise<void>
        ) => void = failure
    ) {
        this.handlers = {
            playing: () => {
                this.confirmed = true;
                this.tryRestore(true);
                this.persist();
                this.changed();
            },
            loadedmetadata: () => this.tryRestore(),
            durationchange: () => this.tryRestore(),
            canplay: () => this.tryRestore(),
            progress: () => this.tryRestore(),
            seeked: () => {
                this.tryRestore(true);
                this.persist();
                this.changed();
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
            timeupdate: () => {
                this.tryRestore(true);
                this.changed();
            },
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
        if (item.kind !== 'live' && Number.isFinite(resume) && resume > 0)
            this.startRestore(resume);
        this.confirmed = false;
        this.setSource(playback.url);
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
    private setSource(url: string) {
        let hls = false;
        try {
            hls = /\.m3u8$/i.test(new URL(url).pathname);
        } catch {
            // Keep the native URL handling for sources without a known format.
        }
        if (!hls) {
            this.video.src = url;
            return;
        }
        // webOS 5 can reject signed master playlists when it guesses the
        // transport from video.src. Select native HLS before the first load.
        const source = this.video.ownerDocument.createElement('source');
        source.src = url;
        source.type = 'application/vnd.apple.mpegurl';
        source.addEventListener('error', () => {
            // A rejected <source> need not emit an error on <video>.
            if (source.parentNode === this.video) this.handlers.error();
        });
        this.video.appendChild(source);
    }
    persist() {
        const item = this.item;
        if (!item || !this.confirmed || this.restore || this.video.seeking)
            return;
        const seconds = Number.isFinite(this.video.currentTime)
            ? this.video.currentTime
            : 0;
        const duration = Number.isFinite(this.video.duration)
            ? this.video.duration
            : 0;
        const progress = { item, seconds, duration, updated: Date.now() };
        this.save(progress).catch(() =>
            this.saveFailure(
                'Viewing progress could not be saved. Free TV storage and retry.',
                () => this.save(progress)
            )
        );
    }
    stop() {
        this.persist();
        this.cancelRestore();
        this.item = undefined;
        this.confirmed = false;
        this.generation++;
        this.video.pause();
        this.video.removeAttribute('src');
        this.video
            .querySelectorAll('source')
            .forEach((source) => source.remove());
        this.video.load();
    }
    resume() {
        if (this.restore?.failed) this.startRestore(this.restore.target);
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
        this.seekTo(this.video.currentTime + delta);
    }
    seekTo(seconds: number) {
        if (
            !this.item ||
            this.item.kind === 'live' ||
            !Number.isFinite(seconds)
        )
            return;
        const target = Math.max(
            0,
            Number.isFinite(this.video.duration) && this.video.duration > 0
                ? Math.min(this.video.duration, seconds)
                : seconds
        );
        if (target > 0) {
            this.startRestore(target);
            this.tryRestore();
        } else {
            try {
                this.video.currentTime = 0;
                this.cancelRestore();
            } catch {
                this.failure(
                    'This stream is not ready to seek. Try again after playback starts.'
                );
            }
        }
        this.changed();
    }
    private cancelRestore() {
        clearInterval(this.restoreTimer);
        this.restoreTimer = undefined;
        this.restore = undefined;
    }
    private startRestore(target: number) {
        this.cancelRestore();
        this.restore = {
            target,
            deadline: Date.now() + 30000,
            lastAttempt: -Infinity,
            attempted: false,
            failed: false,
        };
        this.restoreTimer = setInterval(() => this.tryRestore(), 250);
    }
    private tryRestore(confirm = false) {
        const pending = this.restore;
        const v = this.video;
        if (!pending || pending.failed || !this.item) return;
        // A setter may be accepted before the native pipeline actually seeks.
        // Keep the old saved progress until a media event confirms the result.
        const target =
            Number.isFinite(v.duration) && v.duration > 0
                ? Math.min(pending.target, Math.max(0, v.duration - 1))
                : pending.target;
        if (
            confirm &&
            pending.attempted &&
            !v.seeking &&
            v.readyState >= 2 &&
            Math.abs(v.currentTime - target) <= Math.min(2, target / 4)
        ) {
            this.cancelRestore();
            return;
        }
        if (Date.now() >= pending.deadline) {
            pending.failed = true;
            clearInterval(this.restoreTimer);
            v.pause();
            this.failure(
                'Could not restore the saved position. It is preserved. Retry playback or choose a position on the timeline.'
            );
            this.changed();
            return;
        }
        // webOS may report metadata long before it accepts a VOD seek.
        if (
            !this.confirmed ||
            v.readyState < 2 ||
            v.seeking ||
            Date.now() - pending.lastAttempt < 750
        )
            return;
        let seekable = false;
        for (let i = 0; i < v.seekable.length; i++)
            if (v.seekable.start(i) <= target && v.seekable.end(i) >= target)
                seekable = true;
        if (
            !seekable &&
            (v.seekable.length ||
                v.readyState < 3 ||
                !Number.isFinite(v.duration) ||
                v.duration <= 0)
        )
            return;
        pending.lastAttempt = Date.now();
        try {
            v.currentTime = target;
            pending.attempted = true;
        } catch {
            // Readiness events and the bounded timer retry rejected early seeks.
        }
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
