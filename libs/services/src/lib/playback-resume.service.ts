import { inject, Injectable } from '@angular/core';
import {
    LastPlayingChannel,
    ResumePlaybackSourceType,
} from '@iptvnator/shared/interfaces';
import { SettingsStore } from './settings-store.service';

/**
 * In-memory handoff for a channel that startup wants resumed, from
 * `WorkspaceStartupPreferencesService` to whichever live view ends up
 * rendering that playlist. Not persisted: `SettingsStore.lastPlayingChannel`
 * is the durable record consulted at startup; this is only "which playlist
 * is still waiting to consume it this launch."
 */
interface PendingResume {
    playlistId: string;
    streamUrl: string;
    shouldAutoplay: boolean;
    channelId?: string;
}

@Injectable({
    providedIn: 'root',
})
export class PlaybackResumeService {
    private readonly settingsStore = inject(SettingsStore);
    private pendingResume: PendingResume | null = null;

    setPendingResume(
        playlistId: string,
        streamUrl: string,
        shouldAutoplay: boolean,
        channelId?: string
    ): void {
        this.pendingResume = {
            playlistId,
            streamUrl,
            shouldAutoplay,
            channelId,
        };
    }

    peekPendingResumeStreamUrl(playlistId: string): string | null {
        if (this.pendingResume?.playlistId !== playlistId) {
            return null;
        }

        return this.pendingResume.streamUrl;
    }

    /** Only meaningful once peekPendingResumeStreamUrl has matched. */
    peekPendingResumeShouldAutoplay(playlistId: string): boolean {
        return (
            this.pendingResume?.playlistId === playlistId &&
            this.pendingResume.shouldAutoplay
        );
    }

    peekPendingResumeChannelId(playlistId: string): string | null {
        return this.pendingResume?.playlistId === playlistId
            ? (this.pendingResume.channelId ?? null)
            : null;
    }

    clearPendingResume(): void {
        this.pendingResume = null;
    }

    async recordPlaybackStarted(
        sourceType: ResumePlaybackSourceType,
        playlistId: string,
        streamUrl: string,
        channelId?: string
    ): Promise<void> {
        const lastPlayingChannel: LastPlayingChannel = {
            sourceType,
            playlistId,
            streamUrl,
            channelId,
        };
        const current = this.settingsStore.lastPlayingChannel?.();
        if (
            this.settingsStore.resumePlaybackOnStartup?.() === true &&
            current?.sourceType === sourceType &&
            current.playlistId === playlistId &&
            current.streamUrl === streamUrl &&
            current.channelId === channelId
        )
            return;
        try {
            await this.settingsStore.updateSettings({
                resumePlaybackOnStartup: true,
                lastPlayingChannel,
            });
        } catch (error) {
            console.error('Failed to record playback started:', error);
        }
    }

    async recordPlaybackStopped(): Promise<void> {
        if (this.settingsStore.resumePlaybackOnStartup?.() !== true) return;
        try {
            await this.settingsStore.updateSettings({
                resumePlaybackOnStartup: false,
            });
        } catch (error) {
            console.error('Failed to record playback stopped:', error);
        }
    }
}
