import { Injector } from '@angular/core';
import { StorageMap } from '@ngx-pwa/local-storage';
import { of } from 'rxjs';
import {
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

describe('SettingsStore saved Embedded MPV selection', () => {
    const testWindow = window as unknown as {
        electron?: { getEmbeddedMpvSupport: jest.Mock };
    };
    const originalElectron = testWindow.electron;
    let storage: { get: jest.Mock; set: jest.Mock };
    let injector: Injector;

    /** Loads settings as on startup and lets the support check finish. */
    async function startWithSavedEmbeddedMpv(
        support: EmbeddedMpvSupport
    ): Promise<InstanceType<typeof SettingsStore>> {
        testWindow.electron = {
            getEmbeddedMpvSupport: jest.fn().mockResolvedValue(support),
        };
        const store = injector.get(SettingsStore);
        await store.loadSettings();
        await new Promise((resolve) => setTimeout(resolve));
        expect(testWindow.electron.getEmbeddedMpvSupport).toHaveBeenCalled();
        return store;
    }

    beforeEach(() => {
        const saved: Partial<Settings> = { player: VideoPlayer.EmbeddedMpv };
        storage = {
            get: jest.fn(() => of(saved)),
            set: jest.fn(() => of(undefined)),
        };
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
        testWindow.electron = originalElectron;
    });

    it('keeps the saved player when the support check is inconclusive', async () => {
        // A slow login shell: mpv was looked up before its PATH arrived.
        const store = await startWithSavedEmbeddedMpv({
            ...MPV_MISSING,
            inconclusive: true,
        });

        expect(store.player()).toBe(VideoPlayer.EmbeddedMpv);
        expect(storage.set).not.toHaveBeenCalled();
    });

    it('falls back to the default player on a final unsupported answer', async () => {
        const store = await startWithSavedEmbeddedMpv(MPV_MISSING);

        expect(store.player()).toBe(VideoPlayer.VideoJs);
        expect(storage.set).toHaveBeenCalledWith(
            STORE_KEY.Settings,
            expect.objectContaining({ player: VideoPlayer.VideoJs })
        );
    });

    it('keeps the saved player when Embedded MPV is supported', async () => {
        const store = await startWithSavedEmbeddedMpv({
            supported: true,
            platform: 'linux',
            engine: 'native',
        });

        expect(store.player()).toBe(VideoPlayer.EmbeddedMpv);
        expect(storage.set).not.toHaveBeenCalled();
    });
});
