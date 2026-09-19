import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import { SeasonDownloadCoordinator } from '@iptvnator/portal/shared/data-access';
import { XtreamSerieEpisode } from '@iptvnator/shared/interfaces';
import { DownloadsService } from '@iptvnator/services';
import { SeasonContainerComponent } from './season-container.component';

// Coverage for the season cover beside the season tabs and the season
// thumbnails in the >6-seasons dropdown (both fed by the `seasonPosters`
// input). Lives beside season-container.component.spec.ts, which sits at the
// max-lines cap.

function createEpisode(
    overrides: Partial<XtreamSerieEpisode> = {}
): XtreamSerieEpisode {
    return {
        id: '101',
        episode_num: 1,
        title: 'Pilot',
        container_extension: 'mp4',
        info: { duration: '45 min' },
        custom_sid: '',
        added: '',
        season: 1,
        direct_source: '',
        ...overrides,
    } as XtreamSerieEpisode;
}

describe('SeasonContainerComponent season cover', () => {
    let fixture: ComponentFixture<SeasonContainerComponent>;
    let component: SeasonContainerComponent;

    const setRequiredInputs = (
        seasons: Record<string, XtreamSerieEpisode[]>
    ) => {
        fixture.componentRef.setInput('seasons', seasons);
        fixture.componentRef.setInput('seriesId', 20);
        fixture.componentRef.setInput('playlistId', 'playlist-1');
    };

    const cover = () =>
        fixture.nativeElement.querySelector(
            '[data-testid="season-cover"]'
        ) as HTMLImageElement | null;

    const coverColumnRendered = () =>
        fixture.nativeElement.querySelector('.season-card--with-cover') !==
        null;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [
                NoopAnimationsModule,
                SeasonContainerComponent,
                TranslateModule.forRoot(),
            ],
            providers: [
                {
                    provide: DownloadsService,
                    useValue: {
                        isAvailable: signal(false),
                        hasAuthoritativeDownloadList: signal(false),
                        hasLoadedDownloads: signal(false),
                        downloads: signal([]),
                    },
                },
                { provide: MatDialog, useValue: { open: jest.fn() } },
                SeasonDownloadCoordinator,
                { provide: MatSnackBar, useValue: { open: jest.fn() } },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(SeasonContainerComponent);
        component = fixture.componentInstance;
    });

    it('renders the selected season cover and swaps it with the tab', () => {
        fixture.componentRef.setInput('seasonPosters', {
            '1': 'https://img.test/season-1.jpg',
            '2': 'https://img.test/season-2.jpg',
        });
        setRequiredInputs({
            '1': [createEpisode()],
            '2': [createEpisode({ id: '201', season: 2 })],
        });
        fixture.detectChanges();

        expect(cover()?.src).toBe('https://img.test/season-1.jpg');
        expect(coverColumnRendered()).toBe(true);

        const tabs = fixture.nativeElement.querySelectorAll(
            '.season-tabs__pill'
        ) as NodeListOf<HTMLButtonElement>;
        tabs[1].click();
        fixture.detectChanges();
        expect(cover()?.src).toBe('https://img.test/season-2.jpg');
    });

    it('folds the cover column when the image request fails', () => {
        fixture.componentRef.setInput('seasonPosters', {
            '1': 'https://img.test/season-1.jpg',
            '2': 'https://img.test/season-2.jpg',
        });
        setRequiredInputs({
            '1': [createEpisode()],
            '2': [createEpisode({ id: '201', season: 2 })],
        });
        fixture.detectChanges();

        // A dead image link folds the cover column instead of leaving a
        // broken-image frame beside the tabs; the tabs stay in place.
        cover()?.dispatchEvent(new Event('error'));
        fixture.detectChanges();
        expect(cover()).toBeNull();
        expect(coverColumnRendered()).toBe(false);
        expect(
            fixture.nativeElement.querySelectorAll('.season-tabs__pill')
        ).toHaveLength(2);
    });

    it('withholds the season cover for a one-season item', () => {
        fixture.componentRef.setInput('seasonPosters', {
            '1': 'https://img.test/season-1.jpg',
        });
        setRequiredInputs({ '1': [createEpisode()] });
        fixture.detectChanges();

        expect(cover()).toBeNull();
        expect(coverColumnRendered()).toBe(false);
    });

    describe('dropdown thumbnails (more than six seasons)', () => {
        const sevenSeasons = (): Record<string, XtreamSerieEpisode[]> => {
            const seasons: Record<string, XtreamSerieEpisode[]> = {};
            for (let index = 1; index <= 7; index++) {
                seasons[String(index)] = [
                    createEpisode({
                        id: String(100 + index),
                        season: index,
                    }),
                ];
            }
            return seasons;
        };
        const trigger = () =>
            fixture.nativeElement.querySelector(
                '[data-testid="season-dropdown"]'
            ) as HTMLButtonElement | null;
        const triggerThumb = () =>
            trigger()?.querySelector<HTMLImageElement>(
                '[data-testid="season-dropdown-thumb"]'
            ) ?? null;
        const openMenu = (): HTMLButtonElement[] => {
            trigger()?.click();
            fixture.detectChanges();
            return Array.from(
                document.querySelectorAll<HTMLButtonElement>(
                    '.mat-mdc-menu-panel .mat-mdc-menu-item'
                )
            );
        };

        afterEach(() => fixture.destroy());

        it('renders a thumbnail per menu row that has a poster and none where a season has no poster', () => {
            fixture.componentRef.setInput('seasonPosters', {
                '1': 'https://img.test/season-1.jpg',
                '3': 'https://img.test/season-3.jpg',
            });
            setRequiredInputs(sevenSeasons());
            fixture.detectChanges();

            // The pill row is untouched: the dropdown replaces it.
            expect(
                fixture.nativeElement.querySelectorAll('.season-tabs__pill')
            ).toHaveLength(0);
            const items = openMenu();
            expect(items).toHaveLength(7);
            const thumbOf = (item: HTMLButtonElement) =>
                item.querySelector<HTMLImageElement>(
                    '[data-testid="season-menu-thumb"]'
                );
            expect(thumbOf(items[0])?.src).toBe(
                'https://img.test/season-1.jpg'
            );
            // Projected into the leading slot, ahead of Material's text span.
            expect(thumbOf(items[0])?.parentElement).toBe(items[0]);
            expect(thumbOf(items[1])).toBeNull();
            expect(thumbOf(items[2])?.src).toBe(
                'https://img.test/season-3.jpg'
            );
            // Rows without a poster carry no placeholder either.
            expect(items[1].querySelector('.season-tabs__thumb')).toBeNull();
        });

        it('shows the selected season poster in the closed trigger and swaps it with the selection', () => {
            fixture.componentRef.setInput('seasonPosters', {
                '1': 'https://img.test/season-1.jpg',
                '2': 'https://img.test/season-2.jpg',
            });
            setRequiredInputs(sevenSeasons());
            fixture.detectChanges();

            expect(component.selectedSeason()).toBe('1');
            expect(triggerThumb()?.src).toBe('https://img.test/season-1.jpg');
            expect(
                trigger()?.classList.contains(
                    'season-tabs__dropdown--with-thumb'
                )
            ).toBe(true);

            openMenu()[1].click();
            fixture.detectChanges();
            expect(component.selectedSeason()).toBe('2');
            expect(triggerThumb()?.src).toBe('https://img.test/season-2.jpg');

            // A season without a poster leaves the trigger text-only.
            openMenu()[2].click();
            fixture.detectChanges();
            expect(component.selectedSeason()).toBe('3');
            expect(triggerThumb()).toBeNull();
            expect(
                trigger()?.classList.contains(
                    'season-tabs__dropdown--with-thumb'
                )
            ).toBe(false);
        });

        it('drops a thumbnail whose image request fails instead of leaving a broken frame', () => {
            fixture.componentRef.setInput('seasonPosters', {
                '1': 'https://img.test/season-1.jpg',
            });
            setRequiredInputs(sevenSeasons());
            fixture.detectChanges();

            triggerThumb()?.dispatchEvent(new Event('error'));
            fixture.detectChanges();
            expect(triggerThumb()).toBeNull();
            // The same URL is dropped from the menu row too.
            expect(
                openMenu()[0].querySelector('[data-testid="season-menu-thumb"]')
            ).toBeNull();
        });
    });

    it('withholds the cover when the selected season has no poster', () => {
        fixture.componentRef.setInput('seasonPosters', {
            '2': 'https://img.test/season-2.jpg',
        });
        setRequiredInputs({
            '1': [createEpisode()],
            '2': [createEpisode({ id: '201', season: 2 })],
        });
        fixture.detectChanges();

        expect(component.selectedSeason()).toBe('1');
        expect(cover()).toBeNull();
        expect(coverColumnRendered()).toBe(false);
        expect(
            fixture.nativeElement.querySelector('app-season-tabs')
        ).not.toBeNull();
    });
});
