import { Injectable } from '@angular/core';
import Hls from 'hls.js';
import { BehaviorSubject, Observable } from 'rxjs';

export interface PreBufferedVideo {
    url: string;
    hls?: Hls;
    videoElement?: HTMLVideoElement;
    isReady: boolean;
    error?: string;
}

@Injectable({
    providedIn: 'root',
})
export class VideoPreBufferService {
    private preBufferedVideos = new Map<string, PreBufferedVideo>();
    private preBufferStatus = new BehaviorSubject<Map<string, PreBufferedVideo>>(new Map());

    /**
     * Start pre-buffering a video when play button is clicked
     * @param streamUrl The video stream URL to pre-buffer
     * @returns Observable of the pre-buffering status
     */
    startPreBuffering(streamUrl: string): Observable<PreBufferedVideo | null> {
        return new Observable((observer) => {
            // Check if already pre-buffered
            if (this.preBufferedVideos.has(streamUrl)) {
                const existing = this.preBufferedVideos.get(streamUrl);
                if (existing?.isReady) {
                    observer.next(existing);
                    observer.complete();
                    return;
                }
            }

            // Try pre-buffering with retry logic
            this.attemptPreBuffering(streamUrl, observer, 0);
        });
    }

    /**
     * Attempt pre-buffering with retry logic
     */
    private attemptPreBuffering(streamUrl: string, observer: any, attemptCount: number): void {
        const maxRetries = 2;
        const timeoutDuration = 30000; // 30 seconds timeout

        try {
            // Create a hidden video element for pre-buffering
            const videoElement = document.createElement('video');
            videoElement.style.display = 'none';
            videoElement.muted = true; // Must be muted for autoplay
            videoElement.preload = 'auto';
            document.body.appendChild(videoElement);

            const extension = this.getExtensionFromUrl(streamUrl);
            const isHls = extension === 'm3u8' || extension === 'ts';

            // Set a timeout for the entire pre-buffering operation
            const timeoutId: ReturnType<typeof setTimeout> = setTimeout(() => {
                console.warn('Pre-buffering timeout, cleaning up...');
                this.cleanupPreBufferedVideo(streamUrl);

                if (attemptCount < maxRetries) {
                    console.log(
                        `Retrying pre-buffering after timeout (attempt ${attemptCount + 1}/${maxRetries})...`
                    );
                    setTimeout(() => {
                        this.attemptPreBuffering(streamUrl, observer, attemptCount + 1);
                    }, 1000 * (attemptCount + 1)); // Exponential backoff
                } else {
                    observer.error(new Error('Pre-buffering timeout after all retries'));
                }
            }, timeoutDuration);

            if (isHls && Hls.isSupported()) {
                // Pre-buffer HLS stream
                this.preBufferHls(
                    streamUrl,
                    videoElement,
                    observer,
                    attemptCount,
                    maxRetries,
                    timeoutId
                );
            } else {
                // Pre-buffer regular video
                this.preBufferRegularVideo(
                    streamUrl,
                    videoElement,
                    observer,
                    attemptCount,
                    maxRetries,
                    timeoutId
                );
            }
        } catch (error) {
            console.error('Error during pre-buffering attempt:', error);
            if (attemptCount < maxRetries) {
                console.log(`Retrying pre-buffering (attempt ${attemptCount + 1}/${maxRetries})...`);
                setTimeout(() => {
                    this.attemptPreBuffering(streamUrl, observer, attemptCount + 1);
                }, 1000 * (attemptCount + 1)); // Exponential backoff
            } else {
                observer.error(error);
            }
        }
    }

    /**
     * Pre-buffer HLS stream
     */
    private preBufferHls(
        streamUrl: string,
        videoElement: HTMLVideoElement,
        observer: any,
        attemptCount: number,
        maxRetries: number,
        timeoutId: ReturnType<typeof setTimeout>
    ): void {
        const hls = new Hls({
            enableWorker: true,
            lowLatencyMode: true,
            backBufferLength: 30, // Buffer 30 seconds
        });

        const preBufferedVideo: PreBufferedVideo = {
            url: streamUrl,
            hls,
            videoElement,
            isReady: false,
        };

        this.preBufferedVideos.set(streamUrl, preBufferedVideo);
        this.updateStatus();

        hls.attachMedia(videoElement);

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
            console.log('HLS manifest parsed, starting pre-buffering');
            clearTimeout(timeoutId); // Clear the timeout since we succeeded
            preBufferedVideo.isReady = true;
            this.preBufferedVideos.set(streamUrl, preBufferedVideo);
            this.updateStatus();
            observer.next(preBufferedVideo);
            observer.complete();
        });

        hls.on(Hls.Events.ERROR, (_event, data) => {
            console.warn('HLS pre-buffering error:', data);

            // Handle specific error types
            if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
                console.warn('Network error during pre-buffering, will retry');
                // Don't fail immediately for network errors, let HLS.js retry
                return;
            }

            if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
                console.warn('Media error during pre-buffering:', data.details);
                preBufferedVideo.error = `Media Error: ${data.details}`;
            } else {
                preBufferedVideo.error = `HLS Error: ${data.type}`;
            }

            this.preBufferedVideos.set(streamUrl, preBufferedVideo);
            this.updateStatus();

            // Try to retry if we haven't exceeded max retries
            if (attemptCount < maxRetries) {
                console.log(
                    `Retrying HLS pre-buffering (attempt ${attemptCount + 1}/${maxRetries})...`
                );
                clearTimeout(timeoutId); // Clear the timeout before retrying
                setTimeout(() => {
                    this.cleanupPreBufferedVideo(streamUrl);
                    this.attemptPreBuffering(streamUrl, observer, attemptCount + 1);
                }, 1000 * (attemptCount + 1)); // Exponential backoff
            } else {
                clearTimeout(timeoutId); // Clear the timeout before failing
                observer.error(data);
            }
        });

        hls.loadSource(streamUrl);
    }

    /**
     * Pre-buffer regular video
     */
    private preBufferRegularVideo(
        streamUrl: string,
        videoElement: HTMLVideoElement,
        observer: any,
        attemptCount: number,
        maxRetries: number,
        timeoutId: ReturnType<typeof setTimeout>
    ): void {
        const preBufferedVideo: PreBufferedVideo = {
            url: streamUrl,
            videoElement,
            isReady: false,
        };

        this.preBufferedVideos.set(streamUrl, preBufferedVideo);
        this.updateStatus();

        videoElement.src = streamUrl;
        videoElement.load();

        videoElement.addEventListener('canplaythrough', () => {
            console.log('Regular video can play through, pre-buffering ready');
            clearTimeout(timeoutId); // Clear the timeout since we succeeded
            preBufferedVideo.isReady = true;
            this.preBufferedVideos.set(streamUrl, preBufferedVideo);
            this.updateStatus();
            observer.next(preBufferedVideo);
            observer.complete();
        });

        videoElement.addEventListener('error', (event) => {
            console.warn('Regular video pre-buffering error:', event);

            // Get more detailed error information
            const target = event.target as HTMLVideoElement;
            let errorMessage = 'Video loading error';

            if (target?.error) {
                switch (target.error.code) {
                    case MediaError.MEDIA_ERR_ABORTED:
                        errorMessage = 'Video loading aborted';
                        break;
                    case MediaError.MEDIA_ERR_NETWORK:
                        errorMessage = 'Network error during video loading';
                        break;
                    case MediaError.MEDIA_ERR_DECODE:
                        errorMessage = 'Video decoding error';
                        break;
                    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
                        errorMessage = 'Video format not supported';
                        break;
                    default:
                        errorMessage = `Video error: ${target.error.message || 'Unknown error'}`;
                }
            }

            preBufferedVideo.error = errorMessage;
            this.preBufferedVideos.set(streamUrl, preBufferedVideo);
            this.updateStatus();

            // Try to retry if we haven't exceeded max retries
            if (attemptCount < maxRetries) {
                console.log(
                    `Retrying regular video pre-buffering (attempt ${attemptCount + 1}/${maxRetries})...`
                );
                clearTimeout(timeoutId); // Clear the timeout before retrying
                setTimeout(() => {
                    this.cleanupPreBufferedVideo(streamUrl);
                    this.attemptPreBuffering(streamUrl, observer, attemptCount + 1);
                }, 1000 * (attemptCount + 1)); // Exponential backoff
            } else {
                clearTimeout(timeoutId); // Clear the timeout before failing
                observer.error(event);
            }
        });
    }

    /**
     * Get pre-buffered video data
     */
    getPreBufferedVideo(streamUrl: string): PreBufferedVideo | undefined {
        return this.preBufferedVideos.get(streamUrl);
    }

    /**
     * Check if a video is pre-buffered and ready
     */
    isPreBuffered(streamUrl: string): boolean {
        const preBuffered = this.preBufferedVideos.get(streamUrl);
        return preBuffered?.isReady || false;
    }

    /**
     * Get pre-buffer status observable
     */
    getPreBufferStatus(): Observable<Map<string, PreBufferedVideo>> {
        return this.preBufferStatus.asObservable();
    }

    /**
     * Clean up pre-buffered video resources
     */
    cleanupPreBufferedVideo(streamUrl: string): void {
        const preBuffered = this.preBufferedVideos.get(streamUrl);
        if (preBuffered) {
            if (preBuffered.hls) {
                preBuffered.hls.destroy();
            }
            if (preBuffered.videoElement) {
                preBuffered.videoElement.remove();
            }
            this.preBufferedVideos.delete(streamUrl);
            this.updateStatus();
        }
    }

    /**
     * Clean up all pre-buffered videos
     */
    cleanupAll(): void {
        for (const [streamUrl] of this.preBufferedVideos) {
            this.cleanupPreBufferedVideo(streamUrl);
        }
    }

    /**
     * Update the status subject
     */
    private updateStatus(): void {
        this.preBufferStatus.next(new Map(this.preBufferedVideos));
    }

    /**
     * Get file extension from URL
     */
    private getExtensionFromUrl(url: string): string {
        try {
            const urlObj = new URL(url);
            const pathname = urlObj.pathname;
            const extension = pathname.split('.').pop()?.toLowerCase();
            return extension || '';
        } catch {
            // Fallback for relative URLs
            const extension = url.split('.').pop()?.toLowerCase();
            return extension || '';
        }
    }
}
