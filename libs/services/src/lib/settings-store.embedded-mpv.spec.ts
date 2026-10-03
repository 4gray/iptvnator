import { Injector } from '@angular/core';
import { StorageMap } from '@ngx-pwa/local-storage';
import { of } from 'rxjs';
import {
    EMBEDDED_MPV_SUPPORT_RECHECK_MS,
    EmbeddedMpvSupport,
    Settings,
    STORE_KEY,
    VideoPlayer,
} from '@iptvnator/shared/interfaces';
import { EpgSourceSettingsService } from './epg-source-settings.service';
import { SettingsStore } from './settings-store.service';

/** What the main process answers when the Linux `mpv` probe finds nothing. */
const MPV_MISSING: EmbeddedMpvSupport = {
    supported: false,
    platform: 'linux',
    reason: 'Embedded MPV on Linux requires the mpv executable on PATH.',
    frameCopyAvailable: false,
    frameCopyUnavailableReason: 'helper-probe-failed',
};
/** A slow login shell: mpv was looked up before its PATH arrived. */
const INCONCLUSIVE: EmbeddedMpvSupport = { ...MPV_MISSING, inconclusive: true };
const SUPPORTED: EmbeddedMpvSupport = {
    supported: true,
    platform: 'linux',
    engine: 'native',
};

describe('SettingsStore saved Embedded MPV selection', () => {
    const testWindow = window as unknown as {
        electron?: { getEmbeddedMpvSupport: jest.Mock };
    };
    const originalElectron = testWindow.electron;
    let getEmbeddedMpvSupport: jest.Mock;
    let storage: { get: jest.Mock; set: jest.Mock };
    let injector: Injector;

    /** Loads settings as on startup and lets the first answer be handled. */
    async function start(): Promise<InstanceType<typeof SettingsStore>> {
        const store = injector.get(SettingsStore);
        await store.loadSettings();
        await jest.advanceTimersByTimeAsync(0);
        expect(getEmbeddedMpvSupport).toHaveBeenCalled();
        return store;
    }

    const persistedPlayers = () =>
        storage.set.mock.calls.map(([, settings]) => settings.player);

    beforeEach(() => {
        jest.useFakeTimers();
        const saved: Partial<Settings> = { player: VideoPlayer.EmbeddedMpv };
        storage = {
            get: jest.fn(() => of(saved)),
            set: jest.fn(() => of(undefined)),
        };
        getEmbeddedMpvSupport = jest.fn();
        testWindow.electron = { getEmbeddedMpvSupport };
        injector = Injector.create({
            providers: [
                SettingsStore,
                EpgSourceSettingsService,
                { provide: StorageMap, useValue: storage },
            ],
        });
        jest.spyOn(
            injector.get(EpgSourceSettingsService),
            'synchronize'
        ).mockResolvedValue(undefined);
    });

    afterEach(() => {
        jest.useRealTimers();
        testWindow.electron = originalElectron;
    });

    it('keeps the saved player while the support check is inconclusive', async () => {
        getEmbeddedMpvSupport.mockResolvedValue(INCONCLUSIVE);

        const store = await start();
        await jest.advanceTimersByTimeAsync(EMBEDDED_MPV_SUPPORT_RECHECK_MS);

        expect(store.player()).toBe(VideoPlayer.EmbeddedMpv);
        expect(storage.set).not.toHaveBeenCalled();
    });

    it('falls back to the default player on a final unsupported answer', async () => {
        getEmbeddedMpvSupport.mockResolvedValue(MPV_MISSING);

        const store = await start();

        expect(store.player()).toBe(VideoPlayer.VideoJs);
        expect(storage.set).toHaveBeenCalledWith(
            STORE_KEY.Settings,
            expect.objectContaining({ player: VideoPlayer.VideoJs })
        );
    });

    it('keeps the saved player when Embedded MPV is supported', async () => {
        getEmbeddedMpvSupport.mockResolvedValue(SUPPORTED);

        const store = await start();
        await jest.advanceTimersByTimeAsync(
            EMBEDDED_MPV_SUPPORT_RECHECK_MS * 3
        );

        expect(store.player()).toBe(VideoPlayer.EmbeddedMpv);
        expect(storage.set).not.toHaveBeenCalled();
        expect(getEmbeddedMpvSupport).toHaveBeenCalledTimes(1);
    });

    it('follows an inconclusive answer and falls back once mpv is finally missing', async () => {
        getEmbeddedMpvSupport
            .mockResolvedValueOnce(INCONCLUSIVE)
            .mockResolvedValue(MPV_MISSING);

        const store = await start();
        expect(store.player()).toBe(VideoPlayer.EmbeddedMpv);

        // The login shell answered: mpv really is not installed.
        await jest.advanceTimersByTimeAsync(EMBEDDED_MPV_SUPPORT_RECHECK_MS);

        expect(store.player()).toBe(VideoPlayer.VideoJs);
        expect(persistedPlayers()).toEqual([VideoPlayer.VideoJs]);
    });

    it('follows an inconclusive answer and keeps the player once mpv is found', async () => {
        getEmbeddedMpvSupport
            .mockResolvedValueOnce(INCONCLUSIVE)
            .mockResolvedValue(SUPPORTED);

        const store = await start();
        await jest.advanceTimersByTimeAsync(
            EMBEDDED_MPV_SUPPORT_RECHECK_MS * 20
        );

        expect(store.player()).toBe(VideoPlayer.EmbeddedMpv);
        expect(storage.set).not.toHaveBeenCalled();
        // The final answer ended the checks.
        expect(getEmbeddedMpvSupport).toHaveBeenCalledTimes(2);
    });

    it('leaves a player the user picked meanwhile alone and stops checking', async () => {
        getEmbeddedMpvSupport
            .mockResolvedValueOnce(INCONCLUSIVE)
            .mockResolvedValue(MPV_MISSING);
        const store = await start();

        await store.updateSettings({ player: VideoPlayer.MPV });
        await jest.advanceTimersByTimeAsync(
            EMBEDDED_MPV_SUPPORT_RECHECK_MS * 20
        );

        expect(store.player()).toBe(VideoPlayer.MPV);
        expect(persistedPlayers()).toEqual([VideoPlayer.MPV]);
        expect(getEmbeddedMpvSupport).toHaveBeenCalledTimes(2);
    });

    it('leaves a player picked while the first answer was pending alone', async () => {
        let answer: (support: EmbeddedMpvSupport) => void = () => undefined;
        getEmbeddedMpvSupport.mockReturnValue(
            new Promise<EmbeddedMpvSupport>((resolve) => {
                answer = resolve;
            })
        );
        const store = await start();

        await store.updateSettings({ player: VideoPlayer.VLC });
        answer(MPV_MISSING);
        await jest.advanceTimersByTimeAsync(0);

        expect(store.player()).toBe(VideoPlayer.VLC);
        expect(persistedPlayers()).toEqual([VideoPlayer.VLC]);
    });

    it('falls back to the default player when the support check fails', async () => {
        const warn = jest.spyOn(console, 'warn').mockImplementation();
        getEmbeddedMpvSupport.mockRejectedValue(new Error('bridge failed'));

        try {
            const store = await start();

            expect(store.player()).toBe(VideoPlayer.VideoJs);
            expect(persistedPlayers()).toEqual([VideoPlayer.VideoJs]);
        } finally {
            warn.mockRestore();
        }
    });
});
