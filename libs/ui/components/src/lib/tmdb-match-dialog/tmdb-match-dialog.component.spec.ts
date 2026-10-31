import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { TranslateModule } from '@ngx-translate/core';
import {
    TmdbApiService,
    TmdbRuntimeService,
    TmdbMatchService,
    TmdbEnrichmentService,
} from '@iptvnator/services';
import { TmdbMatchDialogComponent } from './tmdb-match-dialog.component';

describe('TmdbMatchDialogComponent', () => {
    const data = {
        title: 'Красота (8 серий)',
        identity: {
            provider: 'stalker',
            playlistId: 'source',
            mediaType: 'tv',
            itemId: '42',
        },
    };
    const result = {
        id: 318158,
        name: 'Красота',
        original_name: 'Красота',
        first_air_date: '2026-10-30',
    };
    let search: jest.Mock;
    let save: jest.Mock;
    let close: jest.Mock;

    beforeEach(async () => {
        search = jest.fn().mockResolvedValue([result]);
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
                    useValue: { read: () => null, save },
                },
                { provide: TmdbApiService, useValue: { searchTv: search } },
                {
                    provide: TmdbRuntimeService,
                    useValue: {
                        isEnabled: () => true,
                        appLanguage: () => 'ru',
                        apiKey: () => 'key',
                    },
                },
                {
                    provide: TmdbEnrichmentService,
                    useValue: {
                        getDetailsForMatch: jest.fn().mockResolvedValue(result),
                    },
                },
            ],
        }).compileComponents();
    });

    async function create() {
        const fixture = TestBed.createComponent(TmdbMatchDialogComponent);
        fixture.detectChanges();
        await fixture.whenStable();
        return fixture;
    }

    it('requires explicit selection and saves its identity after validating details', async () => {
        const fixture = await create();
        const component = fixture.componentInstance;
        expect(search).toHaveBeenCalledWith('Красота', null, 'ru-RU', 'key');
        expect(component.canSave()).toBe(false);
        component.select(result);
        await component.save();
        expect(save).toHaveBeenCalledWith(data.identity, {
            mode: 'manual',
            tmdbId: 318158,
            title: 'Красота',
        });
        expect(close).toHaveBeenCalledWith(true);
    });

    it('saves provider-only and automatic modes without selecting a search result', async () => {
        const fixture = await create();
        fixture.componentInstance.setMode('provider');
        await fixture.componentInstance.save();
        expect(save).toHaveBeenLastCalledWith(data.identity, {
            mode: 'provider',
        });
        fixture.componentInstance.setMode('auto');
        await fixture.componentInstance.save();
        expect(save).toHaveBeenLastCalledWith(data.identity, null);
    });

    it('keeps the dialog open and releases its close guard when persistence fails', async () => {
        const fixture = await create();
        save.mockRejectedValueOnce(new Error('storage unavailable'));
        fixture.componentInstance.select(result);
        await fixture.componentInstance.save();
        expect(fixture.componentInstance.error()).toBe('save');
        expect(close).not.toHaveBeenCalled();
        expect(TestBed.inject(MatDialogRef).disableClose).toBe(false);
        expect(fixture.componentInstance.saving()).toBe(false);
    });

    it('reports a search failure and recovers through retry', async () => {
        search.mockRejectedValueOnce(new Error('offline'));
        const fixture = await create();
        expect(fixture.componentInstance.error()).toBe('search');
        await fixture.componentInstance.search();
        expect(fixture.componentInstance.error()).toBeNull();
        expect(fixture.componentInstance.results()).toEqual([result]);
    });

    it('discards search responses after the query changes', async () => {
        let finish: (rows: (typeof result)[]) => void = () => undefined;
        search.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    finish = resolve;
                })
        );
        const fixture = TestBed.createComponent(TmdbMatchDialogComponent);
        fixture.componentInstance.setQuery('');
        finish([result]);
        await Promise.resolve();
        expect(fixture.componentInstance.results()).toEqual([]);
        fixture.destroy();
    });
});
