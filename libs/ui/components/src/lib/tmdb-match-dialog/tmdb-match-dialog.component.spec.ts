import { TmdbMatchService } from '@iptvnator/services/tmdb-match';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Language } from '@iptvnator/shared/interfaces';
import {
    TmdbApiService,
    TmdbRuntimeService,
    TmdbEnrichmentService,
    type TmdbMatchChoice,
    type TmdbMatchContext,
    type TmdbSearchResult,
} from '@iptvnator/services';
import { TmdbMatchDialogComponent } from './tmdb-match-dialog.component';

describe('TmdbMatchDialogComponent', () => {
    const result: TmdbSearchResult = {
        id: 900001,
        name: 'Синтетический сериал Альфа',
        original_name: 'Synthetic Series Alpha',
        first_air_date: '2026-01-02',
        origin_country: ['DE', 'CA'],
    };
    let data: TmdbMatchContext;
    let previous: TmdbMatchChoice | null;
    let enabled: boolean;
    let search: jest.Mock;
    let searchMovie: jest.Mock;
    let details: jest.Mock;
    let save: jest.Mock;
    let close: jest.Mock;
    let fixture: ComponentFixture<TmdbMatchDialogComponent> | undefined;

    beforeEach(async () => {
        data = {
            title: 'Синтетический сериал Альфа (8 серий)',
            identity: {
                provider: 'stalker',
                playlistId: 'synthetic-source',
                mediaType: 'tv',
                itemId: '42',
            },
        };
        previous = null;
        enabled = true;
        fixture = undefined;
        search = jest.fn().mockResolvedValue([result]);
        searchMovie = jest.fn().mockResolvedValue([]);
        details = jest.fn().mockResolvedValue(result);
        save = jest.fn().mockResolvedValue(undefined);
        close = jest.fn();
        await TestBed.configureTestingModule({
            imports: [TmdbMatchDialogComponent, TranslateModule.forRoot()],
            providers: [
                { provide: MAT_DIALOG_DATA, useValue: data },
                {
                    provide: MatDialogRef,
                    useValue: { close, disableClose: false },
                },
                {
                    provide: TmdbMatchService,
                    useValue: { read: () => previous, save },
                },
                {
                    provide: TmdbApiService,
                    useValue: { searchTv: search, searchMovie },
                },
                {
                    provide: TmdbRuntimeService,
                    useValue: {
                        isEnabled: () => enabled,
                        appLanguage: () => 'en',
                        apiKey: () => 'fixture-key',
                    },
                },
                {
                    provide: TmdbEnrichmentService,
                    useValue: { getDetailsForMatch: details },
                },
            ],
        }).compileComponents();
        const translate = TestBed.inject(TranslateService);
        translate.setTranslation('en', {
            TMDB_MATCH: {
                CURRENT_MANUAL: 'Manually selected',
                CURRENT_RESULT: 'Currently used',
                MODE_AUTO: 'Automatic',
                MODE_MANUAL: 'Choose in TMDB',
                MODE_PROVIDER: 'Provider data',
                EMPTY: 'No titles found',
                SEARCH_HINT: 'Enter at least two characters',
                SEARCH_ERROR: 'Search unavailable',
                RETRY: 'Retry',
                CANCEL: 'Cancel',
                SAVE: 'Save',
            },
        });
        translate.use('en');
    });

    afterEach(() => {
        fixture?.destroy();
        jest.useRealTimers();
    });

    async function create() {
        fixture = TestBed.createComponent(TmdbMatchDialogComponent);
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();
        return fixture;
    }

    it('renders identifying facts and saves only the explicitly selected result', async () => {
        const view = await create();
        const component = view.componentInstance;
        expect(search).toHaveBeenCalledWith(
            'Синтетический сериал Альфа',
            null,
            'ru-RU',
            'fixture-key'
        );
        expect(searchMovie).not.toHaveBeenCalled();
        const row = view.nativeElement.querySelector(
            '.match-result'
        ) as HTMLButtonElement;
        expect(row.textContent).toContain('Synthetic Series Alpha');
        expect(row.textContent).toContain('2026 · Germany · Canada');
        expect(row.getAttribute('aria-pressed')).toBe('false');
        await component.save();
        expect(save).not.toHaveBeenCalled();
        row.click();
        view.detectChanges();
        expect(row.getAttribute('aria-pressed')).toBe('true');
        await component.save();
        expect(details).toHaveBeenCalledWith('tv', result.id);
        expect(save).toHaveBeenCalledWith(data.identity, {
            mode: 'manual',
            tmdbId: result.id,
            title: result.name,
        });
        expect(close).toHaveBeenCalledWith(true);
    });

    it('searches movies and renders original-title, language and missing-title fallbacks', async () => {
        data.title = 'Synthetic Movie Alpha (2024)';
        data.identity.mediaType = 'movie';
        data.tmdbId = 900101;
        searchMovie.mockResolvedValue([
            {
                id: 900101,
                title: 'Synthetic Movie Alpha',
                original_title: 'Titre synthétique Alpha',
                release_date: '2024-02-03',
                original_language: 'fr',
                poster_path: '/synthetic-alpha.jpg',
            },
            { id: 900102, original_title: 'Synthetic fallback title' },
            { id: 900103, original_name: 'Synthetic fallback name' },
            { id: 900104 },
        ]);
        const view = await create();
        expect(searchMovie).toHaveBeenCalledWith(
            'Synthetic Movie Alpha',
            null,
            'en-US',
            'fixture-key'
        );
        expect(search).not.toHaveBeenCalled();
        const rows = view.nativeElement.querySelectorAll(
            '.match-result'
        ) as NodeListOf<HTMLButtonElement>;
        expect(
            Array.from(rows, (row) => row.querySelector('strong')?.textContent)
        ).toEqual([
            'Synthetic Movie Alpha',
            'Synthetic fallback title',
            'Synthetic fallback name',
            '900104',
        ]);
        expect(rows[0].textContent).toContain('Titre synthétique Alpha');
        expect(rows[0].textContent).toContain('2024 · French');
        expect(rows[0].textContent).toContain('Currently used');
        rows[0].querySelector('img')!.dispatchEvent(new Event('error'));
        view.detectChanges();
        expect(rows[0].querySelector('img')).toBeNull();
        expect(
            rows[0].querySelector('.match-poster mat-icon')?.textContent
        ).toBe('movie');
        rows[0].click();
        await view.componentInstance.save();
        expect(details).toHaveBeenCalledWith('movie', 900101);
    });

    it.each(Object.values(Language))(
        'renders result facts for app locale %s',
        async (locale) => {
            const translate = TestBed.inject(TranslateService);
            translate.setTranslation(locale, {});
            translate.use(locale);
            const view = await create();
            expect(
                view.nativeElement.querySelector('.match-facts')?.textContent
            ).toContain('2026');
            expect(
                view.nativeElement.querySelectorAll('.match-result')
            ).toHaveLength(1);
        }
    );

    it.each([
        ['zhtw', 'zh-TW'],
        ['by', 'be-BY'],
        ['ary', 'ar-MA'],
    ])(
        'localizes country names for the app alias %s',
        async (appLocale, intlLocale) => {
            const translate = TestBed.inject(TranslateService);
            translate.setTranslation(appLocale, {});
            translate.use(appLocale);
            const view = await create();
            const Names = (
                Intl as unknown as {
                    DisplayNames: new (
                        locales: string[],
                        options: { type: string }
                    ) => { of(code: string): string | undefined };
                }
            ).DisplayNames;
            const expectedCountry = new Names([intlLocale], {
                type: 'region',
            }).of('DE');
            expect(
                view.nativeElement.querySelector('.match-facts')?.textContent
            ).toContain(expectedCountry);
        }
    );

    it('restores a manual choice and identifies it before another selection', async () => {
        previous = {
            mode: 'manual',
            tmdbId: result.id,
            title: 'Synthetic saved selection',
        };
        const view = await create();
        expect(
            view.nativeElement.querySelector('.match-current')?.textContent
        ).toContain('Manually selected');
        expect(
            view.nativeElement.querySelector('.match-current')?.textContent
        ).toContain('Synthetic saved selection');
        expect(
            view.nativeElement
                .querySelector('.match-result')
                ?.getAttribute('aria-pressed')
        ).toBe('true');
        expect(view.componentInstance.canSave()).toBe(true);
    });

    it('shows a provider-only choice without presenting the former TMDB result as current', async () => {
        data.tmdbId = result.id;
        previous = { mode: 'provider' };
        const view = await create();
        expect(
            view.nativeElement.querySelector('.match-current')?.textContent
        ).toContain('Provider data');
        expect(
            view.nativeElement.querySelector('.match-current-label')
        ).toBeNull();
        expect(view.componentInstance.canSave()).toBe(false);
    });

    it('saves provider-only and automatic modes without requiring TMDB details', async () => {
        const view = await create();
        enabled = false;
        view.componentInstance.setMode('provider');
        await view.componentInstance.save();
        expect(save).toHaveBeenLastCalledWith(data.identity, {
            mode: 'provider',
        });
        view.componentInstance.setMode('auto');
        await view.componentInstance.save();
        expect(save).toHaveBeenLastCalledWith(data.identity, null);
        expect(details).not.toHaveBeenCalled();
    });

    it('keeps the choice editable and dialog open when persistence fails', async () => {
        const view = await create();
        save.mockRejectedValueOnce(new Error('storage unavailable'));
        view.componentInstance.select(result);
        await view.componentInstance.save();
        expect(view.componentInstance.error()).toBe('save');
        expect(close).not.toHaveBeenCalled();
        expect(TestBed.inject(MatDialogRef).disableClose).toBe(false);
        expect(view.componentInstance.canSave()).toBe(true);
    });

    it.each(['missing', 'offline', 'disabled'])(
        'does not persist a manual selection when validation is %s',
        async (failure) => {
            const view = await create();
            view.componentInstance.select(result);
            if (failure === 'disabled') enabled = false;
            else if (failure === 'offline')
                details.mockRejectedValueOnce(new Error('offline'));
            else details.mockResolvedValueOnce(null);
            await view.componentInstance.save();
            expect(view.componentInstance.error()).toBe('save');
            expect(save).not.toHaveBeenCalled();
            expect(close).not.toHaveBeenCalled();
            expect(TestBed.inject(MatDialogRef).disableClose).toBe(false);
            if (failure === 'disabled') expect(details).not.toHaveBeenCalled();
        }
    );

    it('prevents duplicate saves while details are being validated', async () => {
        const view = await create();
        let finish!: (value: TmdbSearchResult) => void;
        details.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    finish = resolve;
                })
        );
        view.componentInstance.select(result);
        const pending = view.componentInstance.save();
        view.detectChanges();
        expect(TestBed.inject(MatDialogRef).disableClose).toBe(true);
        expect(view.componentInstance.canSave()).toBe(false);
        await view.componentInstance.save();
        expect(details).toHaveBeenCalledTimes(1);
        finish(result);
        await pending;
        expect(save).toHaveBeenCalledTimes(1);
        expect(TestBed.inject(MatDialogRef).disableClose).toBe(false);
    });

    it('reports a disabled search and can retry when TMDB becomes available', async () => {
        enabled = false;
        const view = await create();
        expect(
            view.nativeElement.querySelector('[role="alert"]')?.textContent
        ).toContain('Search unavailable');
        expect(search).not.toHaveBeenCalled();
        enabled = true;
        await view.componentInstance.search();
        view.detectChanges();
        expect(view.nativeElement.querySelector('[role="alert"]')).toBeNull();
        expect(
            view.nativeElement.querySelectorAll('.match-result')
        ).toHaveLength(1);
    });

    it('retries an unsuccessful search when returning to manual selection', async () => {
        search.mockRejectedValueOnce(new Error('offline'));
        const view = await create();
        expect(view.componentInstance.error()).toBe('search');
        view.componentInstance.setMode('provider');
        view.componentInstance.setMode('manual');
        await view.whenStable();
        view.detectChanges();
        expect(search).toHaveBeenCalledTimes(2);
        expect(view.componentInstance.error()).toBeNull();
    });

    it('renders an empty result and allows retaining provider data', async () => {
        search.mockResolvedValueOnce([]);
        const view = await create();
        expect(
            view.nativeElement.querySelector('.match-empty')?.textContent
        ).toContain('No titles found');
        view.componentInstance.setMode('provider');
        await view.componentInstance.save();
        expect(save).toHaveBeenCalledWith(data.identity, { mode: 'provider' });
    });

    it('debounces edits, skips short queries and cancels queued searches on close', async () => {
        jest.useFakeTimers();
        fixture = TestBed.createComponent(TmdbMatchDialogComponent);
        await Promise.resolve();
        const component = fixture.componentInstance;
        component.setQuery('a');
        await jest.advanceTimersByTimeAsync(300);
        expect(search).toHaveBeenCalledTimes(1);
        expect(component.loading()).toBe(false);
        component.setQuery('Synthetic first');
        await jest.advanceTimersByTimeAsync(100);
        component.setQuery('Synthetic latest');
        await jest.advanceTimersByTimeAsync(299);
        expect(search).toHaveBeenCalledTimes(1);
        await jest.advanceTimersByTimeAsync(1);
        expect(search).toHaveBeenLastCalledWith(
            'Synthetic latest',
            null,
            'en-US',
            'fixture-key'
        );
        component.setQuery('Synthetic closed');
        fixture.destroy();
        fixture = undefined;
        await jest.advanceTimersByTimeAsync(300);
        expect(search).toHaveBeenCalledTimes(2);
    });

    it.each(['resolve', 'reject'])(
        'ignores an obsolete search that later %ss',
        async (outcome) => {
            let resolve!: (rows: TmdbSearchResult[]) => void;
            let reject!: (error: Error) => void;
            search.mockImplementationOnce(
                () =>
                    new Promise((done, fail) => {
                        resolve = done;
                        reject = fail;
                    })
            );
            fixture = TestBed.createComponent(TmdbMatchDialogComponent);
            fixture.componentInstance.setQuery('');
            if (outcome === 'resolve') resolve([result]);
            else reject(new Error('obsolete failure'));
            await Promise.resolve();
            expect(fixture.componentInstance.results()).toEqual([]);
            expect(fixture.componentInstance.error()).toBeNull();
        }
    );

    it('cancels through the visible button without saving a correction', async () => {
        const view = await create();
        const cancel = Array.from(
            view.nativeElement.querySelectorAll(
                'button'
            ) as NodeListOf<HTMLButtonElement>
        ).find((button) => button.textContent?.trim() === 'Cancel')!;
        cancel.click();
        expect(close).toHaveBeenCalledWith();
        expect(save).not.toHaveBeenCalled();
    });
});
