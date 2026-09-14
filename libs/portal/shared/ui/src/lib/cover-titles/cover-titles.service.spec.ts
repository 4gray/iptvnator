import { Injector, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SettingsStore } from '@iptvnator/services';
import { CoverTitlesService } from './cover-titles.service';

type ChangeListener = (event: { matches: boolean }) => void;

describe('CoverTitlesService', () => {
    const originalMatchMedia = window.matchMedia;
    let showCoverTitles: ReturnType<typeof signal<boolean | undefined>>;
    let hoverMatches: boolean;
    let listeners: ChangeListener[];
    let removeListener: jest.Mock;

    beforeEach(() => {
        showCoverTitles = signal<boolean | undefined>(true);
        hoverMatches = true;
        listeners = [];
        removeListener = jest.fn();
        window.matchMedia = jest.fn((query: string) => ({
            matches: query === '(hover: hover)' ? hoverMatches : false,
            addEventListener: (_type: string, listener: ChangeListener) => {
                listeners.push(listener);
            },
            removeEventListener: removeListener,
        })) as unknown as typeof window.matchMedia;

        TestBed.configureTestingModule({
            providers: [
                CoverTitlesService,
                { provide: SettingsStore, useValue: { showCoverTitles } },
            ],
        });
    });

    afterEach(() => {
        window.matchMedia = originalMatchMedia;
    });

    it('keeps titles while the setting is on or absent', () => {
        const service = TestBed.inject(CoverTitlesService);
        expect(service.postersOnly()).toBe(false);

        showCoverTitles.set(undefined);
        expect(service.postersOnly()).toBe(false);
    });

    it('switches to the posters-only wall only on an explicit opt-out', () => {
        const service = TestBed.inject(CoverTitlesService);

        showCoverTitles.set(false);

        expect(service.postersOnly()).toBe(true);
    });

    it('ignores the opt-out on touch-only devices where nothing can hover', () => {
        hoverMatches = false;
        const service = TestBed.inject(CoverTitlesService);
        showCoverTitles.set(false);

        expect(service.postersOnly()).toBe(false);
    });

    it('follows the hover capability when a pointer is attached or removed', () => {
        hoverMatches = false;
        const service = TestBed.inject(CoverTitlesService);
        showCoverTitles.set(false);
        expect(service.postersOnly()).toBe(false);

        listeners.forEach((listener) => listener({ matches: true }));
        expect(service.postersOnly()).toBe(true);

        listeners.forEach((listener) => listener({ matches: false }));
        expect(service.postersOnly()).toBe(false);
    });

    it('unsubscribes from the media query when its injector is destroyed', () => {
        const injector = Injector.create({
            providers: [
                { provide: CoverTitlesService },
                { provide: SettingsStore, useValue: { showCoverTitles } },
            ],
            parent: TestBed.inject(Injector),
        });
        injector.get(CoverTitlesService);
        expect(listeners).toHaveLength(1);

        (injector as unknown as { destroy(): void }).destroy();

        expect(removeListener).toHaveBeenCalledWith('change', listeners[0]);
    });
});
