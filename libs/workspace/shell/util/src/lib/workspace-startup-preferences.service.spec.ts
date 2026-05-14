import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { PlaylistsService, SettingsStore } from 'services';
import { StartupBehavior } from 'shared-interfaces';
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

        playlistsService = {
            getAllPlaylists: jest
                .fn()
                .mockReturnValue(
                    of([{ _id: 'playlist-1' }, { _id: 'playlist-2' }])
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

    it('auto-selects the only Xtream source at startup', async () => {
        playlistsService.getAllPlaylists.mockReturnValue(
            of([
                {
                    _id: 'xtream-1',
                    serverUrl: 'http://example.test',
                },
            ])
        );

        await expect(service.resolveInitialWorkspacePath()).resolves.toBe(
            '/workspace/xtreams/xtream-1/vod'
        );
    });

    it('auto-selects the only Stalker source at startup', async () => {
        playlistsService.getAllPlaylists.mockReturnValue(
            of([
                {
                    _id: 'stalker-1',
                    macAddress: '00:1A:79:00:00:01',
                },
            ])
        );

        await expect(service.resolveInitialWorkspacePath()).resolves.toBe(
            '/workspace/stalker/stalker-1/vod'
        );
    });

    it('auto-selects the only M3U source at startup', async () => {
        playlistsService.getAllPlaylists.mockReturnValue(
            of([
                {
                    _id: 'm3u-1',
                    url: 'http://example.test/list.m3u',
                },
            ])
        );

        await expect(service.resolveInitialWorkspacePath()).resolves.toBe(
            '/workspace/playlists/m3u-1/all'
        );
    });

    it('prioritizes the only source over restore-last-view startup routes', async () => {
        settingsStore.startupBehavior.set(StartupBehavior.RestoreLastView);
        playlistsService.getAllPlaylists.mockReturnValue(
            of([
                {
                    _id: 'xtream-1',
                    serverUrl: 'http://example.test',
                },
            ])
        );
        service.persistLastRestorablePath('/workspace/global-recent');

        await expect(service.resolveInitialWorkspacePath()).resolves.toBe(
            '/workspace/xtreams/xtream-1/vod'
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
