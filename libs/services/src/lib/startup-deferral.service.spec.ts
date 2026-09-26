import { TestBed } from '@angular/core/testing';
import {
    STARTUP_DEFERRAL_SAFETY_TIMEOUT_MS,
    STARTUP_WORK_DEFERRAL,
    StartupDeferralService,
} from './startup-deferral.service';

describe('StartupDeferralService', () => {
    const original = window.electron;

    afterEach(() => {
        window.electron = original;
        jest.useRealTimers();
    });

    function create(armed: boolean) {
        TestBed.configureTestingModule({
            providers: armed
                ? [{ provide: STARTUP_WORK_DEFERRAL, useValue: true }]
                : [],
        });
        return TestBed.inject(StartupDeferralService);
    }

    function track(service: StartupDeferralService) {
        const state = { open: false };
        void service.whenFirstContentRendered().then(() => (state.open = true));
        return state;
    }

    it('is open when the application did not arm it', async () => {
        const state = track(create(false));

        await Promise.resolve();

        expect(state.open).toBe(true);
    });

    it('opens one task after the first content rendered', async () => {
        jest.useFakeTimers();
        const service = create(true);
        const state = track(service);

        await Promise.resolve();
        expect(state.open).toBe(false);

        service.markFirstContentRendered();
        await Promise.resolve();
        // Never in the task that rendered the first card.
        expect(state.open).toBe(false);

        jest.advanceTimersByTime(0);
        await Promise.resolve();
        expect(state.open).toBe(true);
    });

    it('opens after the safety timeout when nothing renders', async () => {
        jest.useFakeTimers();
        const state = track(create(true));

        jest.advanceTimersByTime(STARTUP_DEFERRAL_SAFETY_TIMEOUT_MS - 1);
        await Promise.resolve();
        expect(state.open).toBe(false);

        jest.advanceTimersByTime(1);
        await Promise.resolve();
        expect(state.open).toBe(true);
    });

    it('honours the IPTVNATOR_DISABLE_STARTUP_DEFERRAL kill switch', async () => {
        window.electron = {
            startupDeferralDisabled: true,
        } as unknown as typeof window.electron;
        const state = track(create(true));

        await Promise.resolve();

        expect(state.open).toBe(true);
    });
});
