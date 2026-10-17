import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import {
    PlaybackResumeService,
    PlaylistsService,
    SettingsStore,
} from '@iptvnator/services';
import {
    LastPlayingChannel,
    StartupBehavior,
} from '@iptvnator/shared/interfaces';
import { WorkspaceStartupPreferencesService } from './workspace-startup-preferences.service';

describe('WorkspaceStartupPreferencesService', () => {
    let service: WorkspaceStartupPreferencesService;
    let playlistsService: { getAllPlaylists: jest.Mock };
    let settingsStore: {
        loadSettings: jest.Mock;
        showDashboard: ReturnType<typeof signal<boolean>>;
        startupBehavior: ReturnType<typeof signal<StartupBehavior>>;
        rememberLastChannel: ReturnType<typeof signal<boolean>>;
        autoplayOnRelaunch: ReturnType<typeof signal<boolean>>;
        resumePlaybackOnStartup: ReturnType<typeof signal<boolean>>;
        lastPlayingChannel: ReturnType<
            typeof signal<LastPlayingChannel | null>
        >;
    };

    beforeEach(() => {
        localStorage.clear();

        playlistsService = {
            getAllPlaylists: jest
                .fn()
                .mockReturnValue(of([{ _id: 'playlist-1' }])),
        };
        settingsStore = {
            loadSettings: jest.fn().mockResolvedValue(undefined),
            showDashboard: signal(true),
            startupBehavior: signal(StartupBehavior.FirstView),
            rememberLastChannel: signal(false),
            autoplayOnRelaunch: signal(false),
            resumePlaybackOnStartup: signal(false),
            lastPlayingChannel: signal<LastPlayingChannel | null>(null),
        };

        TestBed.configureTestingModule({
            providers: [
                WorkspaceStartupPreferencesService,
                {
                    provide: PlaylistsService,
                    useValue: playlistsService,
                },
                {
                    provide: SettingsStore,
                    useValue: settingsStore,
                },
            ],
        });

        service = TestBed.inject(WorkspaceStartupPreferencesService);
    });

    it('routes to the remembered live channel and carries its autoplay state', async () => {
        settingsStore.rememberLastChannel.set(true);
        settingsStore.autoplayOnRelaunch.set(true);
        settingsStore.resumePlaybackOnStartup.set(true);
        settingsStore.lastPlayingChannel.set({
            sourceType: 'stalker',
            playlistId: 'playlist-1',
            streamUrl: 'https://example.com/session-stream',
            channelId: 'stalker-channel-9',
        });

        await expect(service.resolveInitialWorkspacePath()).resolves.toBe(
            '/workspace/stalker/playlist-1/itv'
        );
        const pending = TestBed.inject(PlaybackResumeService);
        expect(pending.peekPendingResumeChannelId('playlist-1')).toBe(
            'stalker-channel-9'
        );
        expect(pending.peekPendingResumeShouldAutoplay('playlist-1')).toBe(
            true
        );
    });

    it('does not route to a removed playlist', async () => {
        settingsStore.rememberLastChannel.set(true);
        settingsStore.lastPlayingChannel.set({
            sourceType: 'm3u',
            playlistId: 'missing',
            streamUrl: 'https://example.com/channel',
        });

        await expect(service.resolveInitialWorkspacePath()).resolves.toBe(
            '/workspace/dashboard'
        );
        expect(
            TestBed.inject(PlaybackResumeService).peekPendingResumeStreamUrl(
                'missing'
            )
        ).toBeNull();
    });

    it('resolves the first view to dashboard when dashboard is enabled', async () => {
        await expect(service.resolveInitialWorkspacePath()).resolves.toBe(
            '/workspace/dashboard'
        );
    });

    it('resolves the first view to sources when dashboard is hidden', async () => {
        settingsStore.showDashboard.set(false);

        await expect(service.resolveInitialWorkspacePath()).resolves.toBe(
            '/workspace/sources'
        );
    });

    it('restores the last route when restore-last-view is enabled', async () => {
        settingsStore.startupBehavior.set(StartupBehavior.RestoreLastView);
        service.persistLastRestorablePath('/workspace/global-recent?q=matrix');

        await expect(service.resolveInitialWorkspacePath()).resolves.toBe(
            '/workspace/global-recent'
        );
    });

    it('falls back to sources when the stored dashboard route is hidden', async () => {
        settingsStore.showDashboard.set(false);
        settingsStore.startupBehavior.set(StartupBehavior.RestoreLastView);
        service.persistLastRestorablePath('/workspace/dashboard');

        await expect(service.resolveInitialWorkspacePath()).resolves.toBe(
            '/workspace/sources'
        );
    });

    it('canonicalizes detail routes to their section root', () => {
        expect(
            service.getRestorablePath(
                '/workspace/xtreams/playlist-1/vod/123/456?q=matrix'
            )
        ).toBe('/workspace/xtreams/playlist-1/vod');
    });

    it('ignores non-restorable routes', () => {
        expect(service.getRestorablePath('/workspace/settings')).toBeNull();
        expect(service.getRestorablePath('/workspace')).toBeNull();
        expect(service.getRestorablePath('/unknown')).toBeNull();
    });

    it('falls back to the first available view when the stored playlist no longer exists', async () => {
        settingsStore.startupBehavior.set(StartupBehavior.RestoreLastView);
        playlistsService.getAllPlaylists.mockReturnValue(of([]));
        service.persistLastRestorablePath('/workspace/xtreams/missing/live');

        await expect(service.resolveInitialWorkspacePath()).resolves.toBe(
            '/workspace/dashboard'
        );
    });
});
