import { releaseVideoPictureInPicture } from '../player-controls/web-video-picture-in-picture-lifecycle';

export interface VjsVideoElementSessionConfig {
    releasePictureInPicture?: boolean;
    clearPlaybackIssue: () => void;
    emitPlaybackEnded: () => void;
    emitPlaybackStarted?: () => void;
}

export class VjsVideoElementSession {
    private currentVideo: HTMLVideoElement | null = null;
    private destroyed = false;

    private readonly handlePlaying = (): void => {
        this.clearPlaybackIssue();
        this.config.emitPlaybackStarted?.();
    };

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
        video.addEventListener('playing', this.handlePlaying);
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

        if (this.config.releasePictureInPicture) {
            releaseVideoPictureInPicture(this.currentVideo);
        }
        this.currentVideo.removeEventListener(
            'loadeddata',
            this.clearPlaybackIssue
        );
        this.currentVideo.removeEventListener('playing', this.handlePlaying);
        this.currentVideo.removeEventListener('ended', this.emitPlaybackEnded);
        this.currentVideo = null;
    }
}
