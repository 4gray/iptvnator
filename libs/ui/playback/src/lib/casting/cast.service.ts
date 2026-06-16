import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';
import {
    DlnaRendererDevice,
    hasPlaybackHeaders,
    ResolvedPortalPlayback,
} from '@iptvnator/shared/interfaces';
import { RuntimeCapabilitiesService } from '@iptvnator/services';
import {
    getCastMediaType,
    getSafeCastThumbnailUrl,
    isDirectCastUrl,
    supportsAirPlayPicker,
    supportsRemotePlaybackPicker,
} from './cast-media.utils';
import type { GoogleCastRuntime, GoogleCastWindow } from './google-cast.types';

const GOOGLE_CAST_SDK_URL =
    'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1';
const GOOGLE_CAST_SCRIPT_ID = 'iptvnator-google-cast-sdk';

@Injectable({ providedIn: 'root' })
export class CastService {
    private readonly document = inject(DOCUMENT);
    private readonly runtime = inject(RuntimeCapabilitiesService);
    private googleCastRuntimePromise?: Promise<GoogleCastRuntime>;

    get supportsDlna(): boolean {
        return this.runtime.supportsDlnaCasting;
    }

    supportsAirPlay(media: HTMLMediaElement | null): boolean {
        return supportsAirPlayPicker(media);
    }

    supportsRemotePlayback(media: HTMLMediaElement | null): boolean {
        return supportsRemotePlaybackPicker(media);
    }

    canUseGoogleCast(playback: ResolvedPortalPlayback): boolean {
        return (
            this.runtime.isPwa &&
            globalThis.isSecureContext &&
            isDirectCastUrl(playback.streamUrl) &&
            !hasPlaybackHeaders(playback)
        );
    }

    openAirPlayPicker(media: HTMLMediaElement): void {
        if (!supportsAirPlayPicker(media)) {
            throw new Error('AirPlay is not available in this runtime.');
        }

        media.setAttribute('x-webkit-airplay', 'allow');
        (
            media as HTMLMediaElement & {
                webkitShowPlaybackTargetPicker: () => void;
            }
        ).webkitShowPlaybackTargetPicker();
    }

    async openRemotePlaybackPicker(media: HTMLMediaElement): Promise<void> {
        const remote = (
            media as HTMLMediaElement & {
                remote?: { prompt: () => Promise<void> };
            }
        ).remote;
        if (!remote?.prompt) {
            throw new Error('Remote Playback is not available.');
        }

        await remote.prompt();
    }

    async startGoogleCast(playback: ResolvedPortalPlayback): Promise<void> {
        if (!this.canUseGoogleCast(playback)) {
            throw new Error(
                'Google Cast requires a secure PWA and a direct media URL without custom headers.'
            );
        }

        const runtime = await this.loadGoogleCastRuntime();
        const context = runtime.cast.framework.CastContext.getInstance();
        context.setOptions({
            receiverApplicationId:
                runtime.chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
            autoJoinPolicy: runtime.cast.framework.AutoJoinPolicy.ORIGIN_SCOPED,
        });
        await context.requestSession();

        const session = context.getCurrentSession();
        if (!session) {
            throw new Error('Google Cast session was not created.');
        }

        const mediaInfo = new runtime.chrome.cast.media.MediaInfo(
            playback.streamUrl,
            getCastMediaType(playback.streamUrl)
        );
        mediaInfo.streamType = playback.isLive
            ? runtime.chrome.cast.media.StreamType.LIVE
            : runtime.chrome.cast.media.StreamType.BUFFERED;
        const metadata = new runtime.chrome.cast.media.GenericMediaMetadata();
        metadata.title = playback.title;
        const thumbnailUrl = getSafeCastThumbnailUrl(playback);
        if (thumbnailUrl) {
            metadata.images = [{ url: thumbnailUrl }];
        }
        mediaInfo.metadata = metadata;

        await session.loadMedia(
            new runtime.chrome.cast.media.LoadRequest(mediaInfo)
        );
    }

    async discoverDlnaDevices(): Promise<DlnaRendererDevice[]> {
        return (await window.electron?.discoverDlnaRenderers?.()) ?? [];
    }

    async startDlnaPlayback(
        deviceId: string,
        playback: ResolvedPortalPlayback
    ): Promise<void> {
        const result = await window.electron?.startDlnaPlayback?.(
            deviceId,
            playback
        );
        if (!result?.success) {
            throw new Error(result?.error ?? 'DLNA playback failed.');
        }
    }

    private loadGoogleCastRuntime(): Promise<GoogleCastRuntime> {
        if (this.googleCastRuntimePromise) {
            return this.googleCastRuntimePromise;
        }

        const runtimePromise = new Promise<GoogleCastRuntime>(
            (resolve, reject) => {
                const castWindow = window as GoogleCastWindow;
                const existingRuntime = this.getGoogleCastRuntime(castWindow);
                if (existingRuntime) {
                    resolve(existingRuntime);
                    return;
                }

                const previousCallback = castWindow.__onGCastApiAvailable;
                let script: HTMLScriptElement | null = null;
                let settled = false;
                let timeoutId = 0;

                const restoreCallback = () => {
                    if (
                        castWindow.__onGCastApiAvailable === handleAvailability
                    ) {
                        castWindow.__onGCastApiAvailable = previousCallback;
                    }
                };
                const fail = (error: Error) => {
                    if (settled) return;
                    settled = true;
                    window.clearTimeout(timeoutId);
                    restoreCallback();
                    script?.remove();
                    reject(error);
                };
                const handleAvailability = (available: boolean) => {
                    previousCallback?.(available);
                    const runtime = this.getGoogleCastRuntime(castWindow);
                    if (!available || !runtime) {
                        fail(new Error('Google Cast is not available.'));
                        return;
                    }
                    if (settled) return;
                    settled = true;
                    window.clearTimeout(timeoutId);
                    restoreCallback();
                    resolve(runtime);
                };
                castWindow.__onGCastApiAvailable = handleAvailability;
                timeoutId = window.setTimeout(
                    () =>
                        fail(
                            new Error(
                                'Google Cast SDK initialization timed out.'
                            )
                        ),
                    10_000
                );

                if (!this.document.getElementById(GOOGLE_CAST_SCRIPT_ID)) {
                    script = this.document.createElement('script');
                    script.id = GOOGLE_CAST_SCRIPT_ID;
                    script.src = GOOGLE_CAST_SDK_URL;
                    script.async = true;
                    script.onerror = () =>
                        fail(new Error('Google Cast SDK could not be loaded.'));
                    this.document.head.appendChild(script);
                }
            }
        );
        this.googleCastRuntimePromise = runtimePromise.catch((error) => {
            this.googleCastRuntimePromise = undefined;
            throw error;
        });

        return this.googleCastRuntimePromise;
    }

    private getGoogleCastRuntime(
        castWindow: GoogleCastWindow
    ): GoogleCastRuntime | null {
        return castWindow.cast?.framework && castWindow.chrome?.cast?.media
            ? (castWindow as GoogleCastRuntime)
            : null;
    }
}
