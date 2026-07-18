import { Injector } from '@angular/core';
import { StorageMap } from '@ngx-pwa/local-storage';
import { of, Subject } from 'rxjs';
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
    tmdbTrending: true,
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

    it('shares the pending initial settings load across startup waiters', async () => {
        const pendingSettings = new Subject<Partial<Settings> | null>();
        storage.get.mockReturnValue(pendingSettings.asObservable());
        const store = injector.get(SettingsStore);

        const firstWaiter = store.loadSettings();
        const secondWaiter = store.loadSettings();
        const allWaiters = Promise.all([firstWaiter, secondWaiter]);
        let waitersResolved = false;
        void allWaiters.then(() => {
            waitersResolved = true;
        });

        await Promise.resolve();

        expect(waitersResolved).toBe(false);
        expect(store.getSettings().webPlayerSharedControls).toBe(false);

        pendingSettings.next({ webPlayerSharedControls: true });
        pendingSettings.complete();
        await allWaiters;

        expect(storage.get).toHaveBeenCalledTimes(1);
        expect(firstWaiter).toBe(secondWaiter);
        expect(waitersResolved).toBe(true);
        expect(store.getSettings().webPlayerSharedControls).toBe(true);
    });

    it('retries the initial settings load after a storage error', async () => {
        const failingSettings = new Subject<Partial<Settings> | null>();
        storage.get
            .mockReturnValueOnce(failingSettings.asObservable())
            .mockReturnValueOnce(of({ webPlayerSharedControls: true }));
        const consoleError = jest
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);

        try {
            const store = injector.get(SettingsStore);
            const initialLoad = store.loadSettings();

            failingSettings.error(new Error('storage unavailable'));
            await initialLoad;
            await store.loadSettings();

            expect(storage.get).toHaveBeenCalledTimes(2);
            expect(store.getSettings().webPlayerSharedControls).toBe(true);
        } finally {
            consoleError.mockRestore();
        }
    });

    it('uses enabled dashboard rail defaults when no settings are stored', async () => {
        const store = injector.get(SettingsStore);

        await store.loadSettings();

        expect(store.getSettings().streamFormat).toBe('auto');
        expect(store.getSettings().dashboardRails).toEqual(
            expectedDashboardRails()
        );
    });

    it('defaults shared web controls to false when the stored field is missing', async () => {
        storedSettings = {};
        const store = injector.get(SettingsStore);

        await store.loadSettings();

        expect(store.getSettings().webPlayerSharedControls).toBe(false);
    });

    it('restores a persisted true shared web controls preference', async () => {
        storedSettings = {
            webPlayerSharedControls: true,
        };
        const store = injector.get(SettingsStore);

        await store.loadSettings();

        expect(store.getSettings().webPlayerSharedControls).toBe(true);
    });

    it('defaults strip country prefix to false when the stored field is missing', async () => {
        storedSettings = {};
        const store = injector.get(SettingsStore);

        await store.loadSettings();

        expect(store.getSettings().stripCountryPrefix).toBe(false);
    });

    it('restores a persisted true strip country prefix preference', async () => {
        storedSettings = {
            stripCountryPrefix: true,
        };
        const store = injector.get(SettingsStore);

        await store.loadSettings();

        expect(store.getSettings().stripCountryPrefix).toBe(true);
    });

    it('normalizes a persisted string "true" shared web controls preference to false', async () => {
        storedSettings = {
            webPlayerSharedControls: 'true' as unknown as boolean,
        };
        const store = injector.get(SettingsStore);

        await store.loadSettings();

        expect(store.webPlayerSharedControls?.()).toBe(false);
        expect(store.getSettings().webPlayerSharedControls).toBe(false);
    });

    it('persists an updated true shared web controls preference', async () => {
        const store = injector.get(SettingsStore);

        await store.updateSettings({
            webPlayerSharedControls: true,
        });

        expect(storage.set).toHaveBeenCalledWith(
            STORE_KEY.Settings,
            expect.objectContaining({
                webPlayerSharedControls: true,
            })
        );
    });

    it('serializes a malformed string "true" shared web controls update as false', async () => {
        const store = injector.get(SettingsStore);

        await store.updateSettings({
            webPlayerSharedControls: 'true' as unknown as boolean,
        });

        expect(store.webPlayerSharedControls?.()).toBe(false);
        expect(storage.set).toHaveBeenCalledWith(
            STORE_KEY.Settings,
            expect.objectContaining({
                webPlayerSharedControls: false,
            })
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
