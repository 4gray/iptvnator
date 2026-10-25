import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { PlaylistsService, SettingsStore } from '@iptvnator/services';
import { StartupBehavior, rememberLastPlayedLive, consumeStartupLastLive } from '@iptvnator/shared/interfaces';
import { WorkspaceStartupPreferencesService } from './workspace-startup-preferences.service';

describe('WorkspaceStartupPreferencesService', () => {
    let service: WorkspaceStartupPreferencesService;
    let playlistsService: { getAllPlaylists: jest.Mock };
    let settingsStore: {
        loadSettings: jest.Mock;
        showDashboard: ReturnType<typeof signal<boolean>>;
        startupBehavior: ReturnType<typeof signal<StartupBehavior>>;
    };

    beforeEach(() => {
        localStorage.clear();
        sessionStorage.clear();

        playlistsService = {
            getAllPlaylists: jest.fn().mockReturnValue(
                of([{ _id: 'playlist-1' }])
            ),
        };
        settingsStore = {
            loadSettings: jest.fn().mockResolvedValue(undefined),
            showDashboard: signal(true),
            startupBehavior: signal(StartupBehavior.FirstView),
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

    it('opens the last successfully played live channel when its playlist exists', async () => {
        settingsStore.startupBehavior.set(StartupBehavior.PlayLastChannel);
        rememberLastPlayedLive({ sourceType: 'm3u', playlistId: 'playlist-1',
            itemId: 'https://example.invalid/live.m3u8' });

        await expect(service.resolveInitialWorkspacePath()).resolves.toBe(
            '/workspace/global-recent'
        );
        expect(consumeStartupLastLive()).toEqual({
            sourceType: 'm3u', playlistId: 'playlist-1',
            itemId: 'https://example.invalid/live.m3u8',
        });
        expect(consumeStartupLastLive()).toBeNull();
    });

    it('does not attempt startup autoplay when a playlist was removed', async () => {
        settingsStore.startupBehavior.set(StartupBehavior.PlayLastChannel);
        playlistsService.getAllPlaylists.mockReturnValue(of([]));
        rememberLastPlayedLive({ sourceType: 'm3u', playlistId: 'missing',
            itemId: 'https://example.invalid/live.m3u8' });

        await expect(service.resolveInitialWorkspacePath()).resolves.toBe(
            '/workspace/dashboard'
        );
        expect(consumeStartupLastLive()).toBeNull();
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
