import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { LastPlayingChannel } from '@iptvnator/shared/interfaces';
import { PlaybackResumeService } from './playback-resume.service';
import { SettingsStore } from './settings-store.service';

describe('PlaybackResumeService', () => {
    it('records the active channel once and clears only its playing state on stop', async () => {
        const resumePlaybackOnStartup = signal(false);
        const lastPlayingChannel = signal<LastPlayingChannel | null>(null);
        const updateSettings = jest.fn(async (change: {
            resumePlaybackOnStartup?: boolean;
            lastPlayingChannel?: LastPlayingChannel;
        }) => {
            if (change.resumePlaybackOnStartup !== undefined) {
                resumePlaybackOnStartup.set(change.resumePlaybackOnStartup);
            }
            if (change.lastPlayingChannel) {
                lastPlayingChannel.set(change.lastPlayingChannel);
            }
        });
        TestBed.configureTestingModule({
            providers: [
                PlaybackResumeService,
                {
                    provide: SettingsStore,
                    useValue: {
                        resumePlaybackOnStartup,
                        lastPlayingChannel,
                        updateSettings,
                    },
                },
            ],
        });
        const service = TestBed.inject(PlaybackResumeService);

        await service.recordPlaybackStarted(
            'stalker',
            'playlist-1',
            'https://example.com/session-url',
            'channel-7'
        );
        await service.recordPlaybackStarted(
            'stalker',
            'playlist-1',
            'https://example.com/session-url',
            'channel-7'
        );
        expect(updateSettings).toHaveBeenCalledTimes(1);
        expect(lastPlayingChannel()).toEqual({
            sourceType: 'stalker',
            playlistId: 'playlist-1',
            streamUrl: 'https://example.com/session-url',
            channelId: 'channel-7',
        });

        await service.recordPlaybackStopped();
        expect(updateSettings).toHaveBeenCalledTimes(2);
        expect(resumePlaybackOnStartup()).toBe(false);
        expect(lastPlayingChannel()?.channelId).toBe('channel-7');
    });
});
