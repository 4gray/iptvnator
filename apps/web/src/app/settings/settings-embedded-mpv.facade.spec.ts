import { TestBed } from '@angular/core/testing';
import { RuntimeCapabilitiesService } from '@iptvnator/services';
import {
    EMBEDDED_MPV_SUPPORT_RECHECK_MS,
    EmbeddedMpvSupport,
} from '@iptvnator/shared/interfaces';
import { SettingsEmbeddedMpvFacade } from './settings-embedded-mpv.facade';

const SUPPORTED: EmbeddedMpvSupport = { supported: true, platform: 'linux' };
/** A slow login shell: mpv was looked up before its PATH arrived. */
const INCONCLUSIVE: EmbeddedMpvSupport = {
    supported: false,
    platform: 'linux',
    reason: 'mpv executable missing',
    inconclusive: true,
};

describe('SettingsEmbeddedMpvFacade', () => {
    const originalElectron = window.electron;
    let getEmbeddedMpvSupport: jest.Mock;
    let facade: SettingsEmbeddedMpvFacade;

    beforeEach(() => {
        jest.useFakeTimers();
        getEmbeddedMpvSupport = jest.fn();
        window.electron = {
            platform: 'linux',
            getEmbeddedMpvSupport,
        } as unknown as typeof window.electron;
        TestBed.configureTestingModule({
            providers: [
                SettingsEmbeddedMpvFacade,
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: { isElectron: true },
                },
            ],
        });
        facade = TestBed.inject(SettingsEmbeddedMpvFacade);
    });

    afterEach(() => {
        TestBed.resetTestingModule();
        window.electron = originalElectron;
        jest.useRealTimers();
    });

    it('offers Embedded MPV once an inconclusive answer turns into supported', async () => {
        getEmbeddedMpvSupport
            .mockResolvedValueOnce(INCONCLUSIVE)
            .mockResolvedValue(SUPPORTED);

        await facade.load();
        expect(facade.supported()).toBe(false);

        // The page stays open; nobody calls load() again.
        await jest.advanceTimersByTimeAsync(EMBEDDED_MPV_SUPPORT_RECHECK_MS);
        expect(facade.supported()).toBe(true);

        await jest.advanceTimersByTimeAsync(
            EMBEDDED_MPV_SUPPORT_RECHECK_MS * 3
        );
        expect(getEmbeddedMpvSupport).toHaveBeenCalledTimes(2);
    });

    it('stops asking once the settings page is closed', async () => {
        getEmbeddedMpvSupport.mockResolvedValue(INCONCLUSIVE);
        await facade.load();

        TestBed.resetTestingModule();
        await jest.advanceTimersByTimeAsync(
            EMBEDDED_MPV_SUPPORT_RECHECK_MS * 3
        );

        expect(getEmbeddedMpvSupport).toHaveBeenCalledTimes(1);
    });

    it('reports a failed probe as unsupported', async () => {
        getEmbeddedMpvSupport.mockRejectedValue(new Error('addon load failed'));

        await facade.load();

        expect(facade.support()).toEqual({
            supported: false,
            platform: 'linux',
            reason: 'addon load failed',
        });
    });
});
