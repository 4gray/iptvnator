import { Injector } from '@angular/core';
import { StorageMap } from '@ngx-pwa/local-storage';
import { of } from 'rxjs';
import {
    DashboardRailsSettings,
    Language,
    Settings,
    StartupBehavior,
    STORE_KEY,
    StreamFormat,
    Theme,
    VideoPlayer,
} from '@iptvnator/shared/interfaces';
import { SettingsStore } from './settings-store.service';

const expectedDashboardRails = (
    overrides: Partial<DashboardRailsSettings> = {}
): DashboardRailsSettings => ({
    hero: true,
    continueWatching: true,
    liveFavorites: true,
    recentlyWatchedLive: true,
    favoriteMoviesAndSeries: true,
    recentSources: true,
    xtreamRecentlyAdded: true,
    ...overrides,
});

describe('SettingsStore dashboard rail settings', () => {
    let storedSettings: Partial<Settings> | null;
    let injector: Injector;
    let storage: {
        get: jest.Mock;
        set: jest.Mock;
    };

    beforeEach(() => {
        storedSettings = null;
        storage = {
            get: jest.fn(() => of(storedSettings)),
            set: jest.fn(() => of(undefined)),
        };

        injector = Injector.create({
            providers: [
                SettingsStore,
                {
                    provide: StorageMap,
                    useValue: storage,
                },
            ],
        });
    });

    it('uses enabled dashboard rail defaults when no settings are stored', async () => {
        const store = injector.get(SettingsStore);

        await store.loadSettings();

        expect(store.getSettings().streamFormat).toBe('auto');
        expect(store.getSettings().dashboardRails).toEqual(
            expectedDashboardRails()
        );
    });

    it('deep-merges partial stored dashboard rail settings with enabled defaults', async () => {
        storedSettings = {
            player: VideoPlayer.VideoJs,
            streamFormat: StreamFormat.M3u8StreamFormat,
            openStreamOnDoubleClick: false,
            language: Language.ENGLISH,
            showCaptions: false,
            showDashboard: true,
            startupBehavior: StartupBehavior.FirstView,
            showExternalPlaybackBar: true,
            theme: Theme.SystemTheme,
            mpvPlayerPath: '',
            mpvPlayerArguments: '',
            mpvReuseInstance: false,
            vlcPlayerPath: '',
            vlcPlayerArguments: '',
            vlcReuseInstance: false,
            remoteControl: false,
            remoteControlPort: 8765,
            epgUrl: [],
            dashboardRails: {
                recentSources: false,
            },
        } as unknown as Partial<Settings>;

        const store = injector.get(SettingsStore);

        await store.loadSettings();
        await store.updateSettings({
            dashboardRails: {
                ...store.getSettings().dashboardRails,
                liveFavorites: false,
            },
        });

        expect(store.getSettings().dashboardRails).toEqual(
            expectedDashboardRails({
                liveFavorites: false,
                recentSources: false,
            })
        );
        expect(storage.set).toHaveBeenCalledWith(
            STORE_KEY.Settings,
            expect.objectContaining({
                dashboardRails: expectedDashboardRails({
                    liveFavorites: false,
                    recentSources: false,
                }),
            })
        );
    });
});
