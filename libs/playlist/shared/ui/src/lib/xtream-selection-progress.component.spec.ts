import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { MatProgressBar } from '@angular/material/progress-bar';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';
import {
    XtreamSelectedCatalogRefreshService,
    XtreamSelectedCatalogProgress,
} from '@iptvnator/services/xtream-catalog-refresh';
import { XtreamSelectionProgressComponent } from './xtream-selection-progress.component';

const translations = (movie: string, progress: string) => ({
    PORTALS: { MOVIES: movie, LIVE_TV: 'Live TV', SERIES: 'Series' },
    WORKSPACE: {
        SHELL: {
            XTREAM_IMPORT_TITLE: 'Syncing playlist',
            XTREAM_IMPORT_REMOTE_BADGE: 'From provider',
            XTREAM_IMPORT_LOCAL_BADGE: 'On this device',
            XTREAM_IMPORT_LOADING: 'Loading',
            XTREAM_IMPORT_PREPARING: 'Preparing',
            XTREAM_IMPORT_SAVING: 'Saving',
            XTREAM_IMPORT_RESTORING_RECENT: 'Restoring history',
            XTREAM_IMPORT_DETAIL_REMOTE: 'Downloading catalogs',
            XTREAM_IMPORT_DETAIL_LOCAL: 'Saving catalogs',
            XTREAM_IMPORT_PROGRESS: progress,
        },
    },
});

describe('catalog selection progress', () => {
    const progress = signal<XtreamSelectedCatalogProgress | null>(null);
    beforeEach(async () => {
        progress.set(null);
        TestBed.configureTestingModule({
            imports: [
                TranslateModule.forRoot(),
                XtreamSelectionProgressComponent,
            ],
            providers: [
                {
                    provide: XtreamSelectedCatalogRefreshService,
                    useValue: { progress },
                },
            ],
        });
        const translate = TestBed.inject(TranslateService);
        translate.setTranslation(
            'en',
            translations('Movies', '{{type}}: {{current}} / {{total}}')
        );
        translate.setTranslation(
            'de',
            translations('Filme', '{{type}}: {{current}} von {{total}}')
        );
        await firstValueFrom(translate.use('en'));
    });

    it('shows indeterminate provider loading then measured local save progress without a fake cancel action', () => {
        progress.set({
            playlistId: 'p',
            type: 'movie',
            phase: 'loading-content',
            current: 0,
            total: 0,
        });
        const fixture = TestBed.createComponent(
            XtreamSelectionProgressComponent
        );
        fixture.detectChanges();
        const bar = () =>
            fixture.debugElement.query(By.directive(MatProgressBar))
                .componentInstance as MatProgressBar;
        expect(bar().mode).toBe('indeterminate');
        expect(fixture.nativeElement.textContent).toContain('From provider');
        expect(
            fixture.nativeElement
                .querySelector('[role="status"]')
                .getAttribute('aria-live')
        ).toBe('polite');
        expect(
            fixture.nativeElement.querySelector(
                '.workspace-loading-overlay__action'
            )
        ).toBeNull();
        progress.set({
            playlistId: 'p',
            type: 'movie',
            phase: 'saving-content',
            current: 25,
            total: 100,
        });
        fixture.detectChanges();
        expect(bar().mode).toBe('determinate');
        expect(bar().value).toBe(25);
        expect(fixture.nativeElement.textContent).toContain('On this device');
        expect(fixture.nativeElement.textContent).toContain('Movies: 25 / 100');
        progress.set(null);
        fixture.detectChanges();
        expect(fixture.nativeElement.textContent).toContain('Preparing');
        expect(bar().mode).toBe('indeterminate');
    });

    it('updates catalog names and number formatting when language changes during the same scan', async () => {
        progress.set({
            playlistId: 'p',
            type: 'movie',
            phase: 'saving-content',
            current: 1000,
            total: 2000,
        });
        const fixture = TestBed.createComponent(
            XtreamSelectionProgressComponent
        );
        fixture.detectChanges();
        expect(fixture.nativeElement.textContent).toContain(
            'Movies: 1,000 / 2,000'
        );
        await firstValueFrom(TestBed.inject(TranslateService).use('de'));
        fixture.detectChanges();
        expect(fixture.nativeElement.textContent).toContain(
            'Filme: 1.000 von 2.000'
        );
    });
});
