import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { TmdbApiService, TmdbCacheService } from '@iptvnator/services';
import { SettingsTmdbSectionComponent } from './settings-tmdb-section.component';

const CACHE_SIZE_LABEL = '{{entries}} entries · {{size}}';
const CACHE_ERROR_LABEL = 'Could not read the cache';

describe('SettingsTmdbSectionComponent', () => {
    let fixture: ComponentFixture<SettingsTmdbSectionComponent>;
    let getStats: jest.Mock;
    let clear: jest.Mock;

    const createForm = () =>
        new FormGroup({
            tmdb: new FormGroup({
                enabled: new FormControl(true),
                apiKey: new FormControl(''),
            }),
        });

    const queryByTestId = (testId: string): HTMLElement | null =>
        fixture.nativeElement.querySelector(`[data-test-id="${testId}"]`);

    const clearButton = () =>
        queryByTestId('tmdb-clear-cache') as HTMLButtonElement;

    /** Constructor kicks off the stats read; let it settle and render. */
    const settle = async () => {
        await fixture.whenStable();
        fixture.detectChanges();
    };

    /**
     * The section component only exists while its settings page is open, so
     * "reopening the section" means recreating the component.
     */
    const reopenSection = async () => {
        fixture.destroy();
        fixture = TestBed.createComponent(SettingsTmdbSectionComponent);
        fixture.componentRef.setInput('form', createForm());
        fixture.detectChanges();
        await settle();
    };

    beforeEach(async () => {
        getStats = jest.fn().mockResolvedValue({ entries: 42, bytes: 2048 });
        clear = jest.fn().mockResolvedValue(42);

        await TestBed.configureTestingModule({
            imports: [
                SettingsTmdbSectionComponent,
                NoopAnimationsModule,
                ReactiveFormsModule,
                TranslateModule.forRoot(),
            ],
            providers: [
                {
                    provide: TmdbCacheService,
                    useValue: { getStats, clear },
                },
                {
                    provide: TmdbApiService,
                    useValue: { validateApiKey: jest.fn() },
                },
            ],
        }).compileComponents();

        const translate = TestBed.inject(TranslateService);
        translate.setTranslation(
            'en',
            {
                SETTINGS: {
                    TMDB_CACHE_SIZE: CACHE_SIZE_LABEL,
                    TMDB_CACHE_ERROR: CACHE_ERROR_LABEL,
                },
            },
            true
        );
        translate.use('en');

        fixture = TestBed.createComponent(SettingsTmdbSectionComponent);
        fixture.componentRef.setInput('form', createForm());
        fixture.detectChanges();
    });

    it('sizes the cache as soon as the section page opens', async () => {
        await settle();

        expect(getStats).toHaveBeenCalledTimes(1);
        expect(queryByTestId('tmdb-cache-size')?.textContent).toContain('42');
    });

    it('clears the cache and re-reads the size', async () => {
        await settle();
        getStats.mockResolvedValue({ entries: 0, bytes: 0 });

        clearButton().click();
        await fixture.whenStable();
        fixture.detectChanges();

        expect(clear).toHaveBeenCalledTimes(1);
        expect(getStats).toHaveBeenCalledTimes(2);
        // Nothing left to clear — the button stops offering it
        expect(clearButton().disabled).toBe(true);
    });

    it('surfaces a failed clear instead of claiming an empty cache', async () => {
        await settle();
        clear.mockResolvedValue(null);

        clearButton().click();
        await fixture.whenStable();
        fixture.detectChanges();

        expect(queryByTestId('tmdb-cache-size')?.textContent).toContain(
            CACHE_ERROR_LABEL
        );
        // Still actionable: the rows are there, the user can retry
        expect(clearButton().disabled).toBe(false);
    });

    it('surfaces a failed size read the same way', async () => {
        getStats.mockReset();
        getStats.mockResolvedValue(null);
        await reopenSection();

        expect(queryByTestId('tmdb-cache-size')?.textContent).toContain(
            CACHE_ERROR_LABEL
        );
    });

    it('retries the size read next time the section is opened', async () => {
        getStats.mockReset();
        getStats.mockResolvedValueOnce(null);
        getStats.mockResolvedValue({ entries: 42, bytes: 2048 });
        await reopenSection();
        expect(queryByTestId('tmdb-cache-size')?.textContent).toContain(
            CACHE_ERROR_LABEL
        );

        // Otherwise a single transient failure sticks until the destructive
        // Clear button shifts it — reopening the page must retry instead
        await reopenSection();

        expect(getStats).toHaveBeenCalledTimes(2);
        expect(queryByTestId('tmdb-cache-size')?.textContent).toContain('42');
    });
});
