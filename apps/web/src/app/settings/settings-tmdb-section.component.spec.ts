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

    /** The stats effect only fires once the TMDB section is the active one */
    const activate = async (section = 'tmdb') => {
        fixture.componentRef.setInput('activeSection', section);
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();
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
        fixture.componentRef.setInput('activeSection', 'general');
        fixture.detectChanges();
    });

    it('defers the full-table scan until the section is opened', async () => {
        expect(getStats).not.toHaveBeenCalled();

        await activate();

        expect(getStats).toHaveBeenCalledTimes(1);
        expect(queryByTestId('tmdb-cache-size')?.textContent).toContain('42');
    });

    it('clears the cache and re-reads the size', async () => {
        await activate();
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
        await activate();
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
        getStats.mockResolvedValue(null);

        await activate();

        expect(queryByTestId('tmdb-cache-size')?.textContent).toContain(
            CACHE_ERROR_LABEL
        );
    });

    it('retries the size read next time the section is opened', async () => {
        getStats.mockResolvedValueOnce(null);
        await activate();
        expect(queryByTestId('tmdb-cache-size')?.textContent).toContain(
            CACHE_ERROR_LABEL
        );

        await activate('general');
        await activate();

        // Otherwise a single transient failure sticks for the life of the
        // page, and only the destructive Clear button can shift it
        expect(getStats).toHaveBeenCalledTimes(2);
        expect(queryByTestId('tmdb-cache-size')?.textContent).toContain('42');
    });
});
