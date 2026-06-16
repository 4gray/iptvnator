import { TestBed } from '@angular/core/testing';
import { RuntimeCapabilitiesService } from '@iptvnator/services';
import { CastService } from './cast.service';
import type { GoogleCastWindow } from './google-cast.types';

describe('CastService', () => {
    let service: CastService;
    let castWindow: GoogleCastWindow;

    beforeEach(() => {
        Object.defineProperty(globalThis, 'isSecureContext', {
            configurable: true,
            value: true,
        });
        castWindow = window as GoogleCastWindow;
        delete castWindow.cast;
        delete castWindow.chrome;
        delete castWindow.__onGCastApiAvailable;

        TestBed.configureTestingModule({
            providers: [
                CastService,
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: {
                        isPwa: true,
                        supportsDlnaCasting: false,
                    },
                },
            ],
        });
        service = TestBed.inject(CastService);
    });

    afterEach(() => {
        document.getElementById('iptvnator-google-cast-sdk')?.remove();
        delete castWindow.cast;
        delete castWindow.chrome;
        delete castWindow.__onGCastApiAvailable;
        TestBed.resetTestingModule();
    });

    it('restores the global callback and permits retry after SDK failure', async () => {
        const previousCallback = jest.fn();
        castWindow.__onGCastApiAvailable = previousCallback;
        const playback = {
            streamUrl: 'https://example.com/live.m3u8',
            title: 'Live',
            isLive: true,
        };

        const firstAttempt = service.startGoogleCast(playback);
        const firstScript = document.getElementById(
            'iptvnator-google-cast-sdk'
        );
        expect(firstScript).not.toBeNull();

        const firstRejection = expect(firstAttempt).rejects.toThrow(
            'Google Cast is not available.'
        );
        castWindow.__onGCastApiAvailable?.(false);
        await firstRejection;

        expect(previousCallback).toHaveBeenCalledWith(false);
        expect(castWindow.__onGCastApiAvailable).toBe(previousCallback);
        expect(firstScript?.isConnected).toBe(false);

        const secondAttempt = service.startGoogleCast(playback);
        const secondScript = document.getElementById(
            'iptvnator-google-cast-sdk'
        );
        expect(secondScript).not.toBeNull();
        expect(secondScript).not.toBe(firstScript);

        const secondRejection = expect(secondAttempt).rejects.toThrow(
            'Google Cast is not available.'
        );
        castWindow.__onGCastApiAvailable?.(false);
        await secondRejection;
    });
});
