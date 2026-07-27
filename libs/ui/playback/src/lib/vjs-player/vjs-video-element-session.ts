export interface VjsVideoElementSessionConfig {
    clearPlaybackIssue: () => void;
    emitPlaybackEnded: () => void;
}

export class VjsVideoElementSession {
    private currentVideo: HTMLVideoElement | null = null;
    private destroyed = false;

    private readonly clearPlaybackIssue = () => {
        this.config.clearPlaybackIssue();
    };

    private readonly emitPlaybackEnded = () => {
        this.config.emitPlaybackEnded();
    };

    constructor(private readonly config: VjsVideoElementSessionConfig) {}

    bind(video: HTMLVideoElement): void {
        if (this.destroyed || this.currentVideo === video) {
            return;
        }

        this.detach();
        this.currentVideo = video;
        video.addEventListener('loadeddata', this.clearPlaybackIssue);
        video.addEventListener('playing', this.clearPlaybackIssue);
        video.addEventListener('ended', this.emitPlaybackEnded);
    }

    video(): HTMLVideoElement | null {
        return this.currentVideo;
    }

    destroy(): void {
        if (this.destroyed) {
            return;
        }

        this.detach();
        this.destroyed = true;
    }

    private detach(): void {
        if (!this.currentVideo) {
            return;
        }

        this.currentVideo.removeEventListener(
            'loadeddata',
            this.clearPlaybackIssue
        );
        this.currentVideo.removeEventListener(
            'playing',
            this.clearPlaybackIssue
        );
        this.currentVideo.removeEventListener('ended', this.emitPlaybackEnded);
        this.currentVideo = null;
    }
}
