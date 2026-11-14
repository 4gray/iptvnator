import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SettingsStore } from '@iptvnator/services';
import { CoverTitlesService } from './cover-titles.service';

describe('CoverTitlesService', () => {
    it('shows titles by default and follows the saved preference on touch devices', () => {
        const showCoverTitles = signal<boolean | undefined>(undefined);
        const originalMatchMedia = window.matchMedia;
        window.matchMedia = jest.fn().mockReturnValue({
            matches: false,
            addEventListener: jest.fn(),
            removeEventListener: jest.fn(),
        });
        try {
            TestBed.configureTestingModule({
                providers: [
                    { provide: SettingsStore, useValue: { showCoverTitles } },
                ],
            });
            const service = TestBed.inject(CoverTitlesService);
            expect(service.postersOnly()).toBe(false);

            showCoverTitles.set(false);
            expect(service.postersOnly()).toBe(true);

            showCoverTitles.set(true);
            expect(service.postersOnly()).toBe(false);
        } finally {
            window.matchMedia = originalMatchMedia;
        }
    });
});
