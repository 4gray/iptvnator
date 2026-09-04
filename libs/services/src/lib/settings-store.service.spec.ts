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
    tmdbRecommendations: true,
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
        expect(store.getSettings().webPlayerSharedControls).toBe(true);

        pendingSettings.next({ webPlayerSharedControls: false });
        pendingSettings.complete();
        await allWaiters;

        expect(storage.get).toHaveBeenCalledTimes(1);
        expect(firstWaiter).toBe(secondWaiter);
        expect(waitersResolved).toBe(true);
        expect(store.getSettings().webPlayerSharedControls).toBe(false);
    });

    it('retries the initial settings load after a storage error', async () => {
        const failingSettings = new Subject<Partial<Settings> | null>();
        storage.get
            .mockReturnValueOnce(failingSettings.asObservable())
            .mockReturnValueOnce(of({ webPlayerSharedControls: false }));
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
            expect(store.getSettings().webPlayerSharedControls).toBe(false);
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

    it('defaults shared web controls to true when the stored field is missing', async () => {
        storedSettings = {};
        const store = injector.get(SettingsStore);

        await store.loadSettings();

        expect(store.getSettings().webPlayerSharedControls).toBe(true);
    });

    it('restores a persisted false shared web controls opt-out', async () => {
        storedSettings = {
            webPlayerSharedControls: false,
        };
        const store = injector.get(SettingsStore);

        await store.loadSettings();

        expect(store.getSettings().webPlayerSharedControls).toBe(false);
    });

    it('defaults embedded MPV auto-reconnect to true when the stored field is missing', async () => {
        storedSettings = {};
        const store = injector.get(SettingsStore);

        await store.loadSettings();

        expect(store.getSettings().embeddedMpvAutoReconnect).toBe(true);
    });

    it('restores a persisted false embedded MPV auto-reconnect opt-out', async () => {
        storedSettings = { embeddedMpvAutoReconnect: false };
        const store = injector.get(SettingsStore);

        await store.loadSettings();

        expect(store.getSettings().embeddedMpvAutoReconnect).toBe(false);
    });

    it('defaults strip country prefix to false when the stored field is missing', async () => {
        storedSettings = {};
        const store = injector.get(SettingsStore);

        await store.loadSettings();

        expect(store.getSettings().stripCountryPrefix).toBe(false);
    });

    it('defaults the startup window mode to normal when the stored field is missing', async () => {
        storedSettings = {};
        const store = injector.get(SettingsStore);

        await store.loadSettings();

        expect(store.getSettings().startupWindowMode).toBe('normal');
    });

    it('restores a persisted fullscreen startup window mode', async () => {
        storedSettings = { startupWindowMode: 'fullscreen' };
        const store = injector.get(SettingsStore);

        await store.loadSettings();

        expect(store.getSettings().startupWindowMode).toBe('fullscreen');
    });

    it('normalizes a persisted unknown startup window mode to normal', async () => {
        storedSettings = {
            startupWindowMode:
                'kiosk' as unknown as Settings['startupWindowMode'],
        };
        const store = injector.get(SettingsStore);

        await store.loadSettings();

        expect(store.getSettings().startupWindowMode).toBe('normal');
    });

    it('defaults ambient player mode to false when the stored field is missing', async () => {
        storedSettings = {};
        const store = injector.get(SettingsStore);

        await store.loadSettings();

        expect(store.getSettings().playerAmbientMode).toBe(false);
    });

    it('restores a persisted true ambient player mode preference', async () => {
        storedSettings = { playerAmbientMode: true };
        const store = injector.get(SettingsStore);

        await store.loadSettings();

        expect(store.getSettings().playerAmbientMode).toBe(true);
    });

    it('defaults the up next rail to true when the stored field is missing', async () => {
        storedSettings = {};
        const store = injector.get(SettingsStore);

        await store.loadSettings();

        expect(store.getSettings().playerUpNextRail).toBe(true);
    });

    it('restores a persisted false up next rail preference', async () => {
        storedSettings = { playerUpNextRail: false };
        const store = injector.get(SettingsStore);

        await store.loadSettings();

        expect(store.getSettings().playerUpNextRail).toBe(false);
    });

    it('defaults the fullscreen channel panel to true when the stored field is missing', async () => {
        storedSettings = {};
        const store = injector.get(SettingsStore);

        await store.loadSettings();

        expect(store.getSettings().fullscreenChannelPanel).toBe(true);
    });

    it('restores a persisted false fullscreen channel panel preference', async () => {
        storedSettings = { fullscreenChannelPanel: false };
        const store = injector.get(SettingsStore);

        await store.loadSettings();

        expect(store.getSettings().fullscreenChannelPanel).toBe(false);
    });

    it('restores a persisted true strip country prefix preference', async () => {
        storedSettings = {
            stripCountryPrefix: true,
        };
        const store = injector.get(SettingsStore);

        await store.loadSettings();

        expect(store.getSettings().stripCountryPrefix).toBe(true);
    });

    it('normalizes a persisted non-boolean shared web controls value to the default', async () => {
        storedSettings = {
            webPlayerSharedControls: 'false' as unknown as boolean,
        };
        const store = injector.get(SettingsStore);

        await store.loadSettings();

        // Only an explicit boolean false opts out; junk falls to the default.
        expect(store.webPlayerSharedControls?.()).toBe(true);
        expect(store.getSettings().webPlayerSharedControls).toBe(true);
    });

    it('persists an updated false shared web controls opt-out', async () => {
        const store = injector.get(SettingsStore);

        await store.updateSettings({
            webPlayerSharedControls: false,
        });

        expect(store.webPlayerSharedControls?.()).toBe(false);
        expect(storage.set).toHaveBeenCalledWith(
            STORE_KEY.Settings,
            expect.objectContaining({
                webPlayerSharedControls: false,
            })
        );
    });

    it('serializes a malformed string shared web controls update as the default', async () => {
        const store = injector.get(SettingsStore);

        await store.updateSettings({
            webPlayerSharedControls: 'false' as unknown as boolean,
        });

        expect(store.webPlayerSharedControls?.()).toBe(true);
        expect(storage.set).toHaveBeenCalledWith(
            STORE_KEY.Settings,
            expect.objectContaining({
                webPlayerSharedControls: true,
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

describe('SettingsStore storage failure reporting', () => {
    let injector: Injector;
    let storage: {
        get: jest.Mock;
        set: jest.Mock;
    };
    let consoleError: jest.SpyInstance;

    beforeEach(() => {
        storage = {
            get: jest.fn(() => of(null)),
            set: jest.fn(() => of(undefined)),
        };
        consoleError = jest
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);

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

    afterEach(() => {
        consoleError.mockRestore();
    });

    it('reports no failure while storage works', async () => {
        const store = injector.get(SettingsStore);

        await store.loadSettings();
        await store.updateSettings({ language: Language.FRENCH });

        expect(store.storageFailure()).toBeNull();
    });

    it('flags a failed initial load so defaults are not mistaken for saved values', async () => {
        const failingSettings = new Subject<Partial<Settings> | null>();
        storage.get.mockReturnValueOnce(failingSettings.asObservable());
        const store = injector.get(SettingsStore);

        const initialLoad = store.loadSettings();
        failingSettings.error(new Error('storage unavailable'));
        await initialLoad;

        expect(store.storageFailure()).toBe('load');
        expect(store.getSettings().language).toBe(Language.ENGLISH);
    });

    it('flags a failed save and rethrows instead of silently keeping the in-memory change', async () => {
        storage.set.mockImplementationOnce(() => {
            throw new Error('quota exceeded');
        });
        const store = injector.get(SettingsStore);
        await store.loadSettings();

        await expect(
            store.updateSettings({ language: Language.FRENCH })
        ).rejects.toThrow('quota exceeded');

        expect(store.storageFailure()).toBe('save');
        // The in-memory patch still applied — that is exactly why the flag
        // matters: the UI shows French but nothing reached disk.
        expect(store.getSettings().language).toBe(Language.FRENCH);
    });

    it('clears the failure once a later save succeeds', async () => {
        storage.set.mockImplementationOnce(() => {
            throw new Error('quota exceeded');
        });
        const store = injector.get(SettingsStore);
        await store.loadSettings();

        await expect(
            store.updateSettings({ language: Language.FRENCH })
        ).rejects.toThrow('quota exceeded');
        expect(store.storageFailure()).toBe('save');

        await store.updateSettings({ language: Language.GERMAN });

        expect(store.storageFailure()).toBeNull();
    });

    it('clears a load failure once the retried load succeeds', async () => {
        const failingSettings = new Subject<Partial<Settings> | null>();
        storage.get
            .mockReturnValueOnce(failingSettings.asObservable())
            .mockReturnValueOnce(of({ language: Language.FRENCH }));
        const store = injector.get(SettingsStore);

        const initialLoad = store.loadSettings();
        failingSettings.error(new Error('storage unavailable'));
        await initialLoad;
        expect(store.storageFailure()).toBe('load');

        await store.loadSettings();

        expect(store.storageFailure()).toBeNull();
        expect(store.getSettings().language).toBe(Language.FRENCH);
    });
});
