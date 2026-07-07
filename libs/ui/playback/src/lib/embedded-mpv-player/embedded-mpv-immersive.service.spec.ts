import { effect, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { EmbeddedMpvImmersiveService } from './embedded-mpv-immersive.service';

const IMMERSIVE_BODY_CLASS = 'embedded-mpv-immersive';
const FULLSCREEN_BODY_CLASS = 'embedded-mpv-fullscreen';

describe('EmbeddedMpvImmersiveService', () => {
    let service: EmbeddedMpvImmersiveService;

    beforeEach(() => {
        service = new EmbeddedMpvImmersiveService();
        document.body.classList.remove(IMMERSIVE_BODY_CLASS);
        document.body.classList.remove(FULLSCREEN_BODY_CLASS);
    });

    afterEach(() => {
        document.body.classList.remove(IMMERSIVE_BODY_CLASS);
        document.body.classList.remove(FULLSCREEN_BODY_CLASS);
    });

    it('adds the body class on first activation', () => {
        service.activate();
        expect(document.body.classList.contains(IMMERSIVE_BODY_CLASS)).toBe(
            true
        );
    });

    it('removes the body class on balanced deactivation', () => {
        service.activate();
        service.deactivate();
        expect(document.body.classList.contains(IMMERSIVE_BODY_CLASS)).toBe(
            false
        );
    });

    it('keeps the class until the last activator deactivates (ref-counted)', () => {
        service.activate();
        service.activate();
        service.deactivate();
        expect(document.body.classList.contains(IMMERSIVE_BODY_CLASS)).toBe(
            true
        );
        service.deactivate();
        expect(document.body.classList.contains(IMMERSIVE_BODY_CLASS)).toBe(
            false
        );
    });

    it('ignores unbalanced deactivation', () => {
        expect(() => service.deactivate()).not.toThrow();
        expect(document.body.classList.contains(IMMERSIVE_BODY_CLASS)).toBe(
            false
        );
    });

    it('drives the active signal across the ref-count lifecycle', () => {
        expect(service.active()).toBe(false);
        service.activate();
        expect(service.active()).toBe(true);
        service.activate();
        service.deactivate();
        // Still active — second activator holds it open.
        expect(service.active()).toBe(true);
        service.deactivate();
        expect(service.active()).toBe(false);
    });

    it('toggles the fullscreen signal and body class together', () => {
        service.setFullscreen(true);
        expect(service.fullscreen()).toBe(true);
        expect(document.body.classList.contains(FULLSCREEN_BODY_CLASS)).toBe(
            true
        );
        service.setFullscreen(false);
        expect(service.fullscreen()).toBe(false);
        expect(document.body.classList.contains(FULLSCREEN_BODY_CLASS)).toBe(
            false
        );
    });

    it('stores and clears the native video rect', () => {
        expect(service.rect()).toBeNull();
        const rect = { x: 10, y: 20, width: 640, height: 360 };
        service.setRect(rect);
        expect(service.rect()).toEqual(rect);
        service.setRect(null);
        expect(service.rect()).toBeNull();
    });

    describe('dev tunnel guard', () => {
        const rect = { x: 0, y: 0, width: 640, height: 360 };
        let warnSpy: jest.SpyInstance;

        beforeEach(() => {
            warnSpy = jest.spyOn(console, 'warn').mockImplementation();
        });

        afterEach(() => {
            warnSpy.mockRestore();
            delete (document as { elementsFromPoint?: unknown })
                .elementsFromPoint;
        });

        it('warns when an opaque element covers the tunnel hole', () => {
            const cover = document.createElement('div');
            cover.style.backgroundColor = 'rgb(0, 0, 0)';
            (
                document as unknown as { elementsFromPoint: unknown }
            ).elementsFromPoint = jest.fn().mockReturnValue([cover]);
            service.activate();
            service.setRect(rect);
            expect(warnSpy).toHaveBeenCalledWith(
                expect.stringContaining('cover the immersive tunnel'),
                expect.any(Array)
            );
        });

        it('stays silent when the tunnel is clean', () => {
            const clear = document.createElement('div');
            clear.style.backgroundColor = 'rgba(0, 0, 0, 0)';
            (
                document as unknown as { elementsFromPoint: unknown }
            ).elementsFromPoint = jest.fn().mockReturnValue([clear]);
            service.activate();
            service.setRect(rect);
            expect(warnSpy).not.toHaveBeenCalled();
        });

        it('does not check while the tunnel is inactive', () => {
            const elementsFromPoint = jest.fn().mockReturnValue([]);
            (
                document as unknown as { elementsFromPoint: unknown }
            ).elementsFromPoint = elementsFromPoint;
            service.setRect(rect);
            expect(elementsFromPoint).not.toHaveBeenCalled();
        });

        // Regression for the renderer freeze: the player component feeds the
        // rect from inside an `effect` that WRITES `rect` on every bounds tick,
        // passing a fresh object each time (measureBounds()). If the guard reads
        // `active()`/`rect()` reactively, that effect takes a dependency on the
        // signal it writes and re-runs forever, blocking the main thread. This
        // test drives setRect from a real effect and asserts it stabilizes.
        it('does not self-trigger the writing effect into an infinite loop', () => {
            (
                document as unknown as { elementsFromPoint: unknown }
            ).elementsFromPoint = jest.fn().mockReturnValue([]);
            service.activate();

            const boundsTick = signal(0);
            let runs = 0;

            TestBed.runInInjectionContext(() => {
                effect(() => {
                    boundsTick(); // the only intended dependency
                    runs += 1;
                    // measureBounds() returns a NEW object on every call.
                    service.setRect({ x: 0, y: 0, width: 640, height: 360 });
                });
            });

            // Without the untracked guard this flush never returns (the effect
            // re-dirties itself); Angular aborts it as a cycle. With the fix it
            // runs exactly once.
            TestBed.tick();
            expect(runs).toBe(1);

            // An actual bounds change re-runs the effect exactly once more.
            boundsTick.set(1);
            TestBed.tick();
            expect(runs).toBe(2);
        });
    });
});
