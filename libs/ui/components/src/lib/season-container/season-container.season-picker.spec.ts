import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { SeasonDownloadCoordinator } from '@iptvnator/portal/shared/data-access';
import { XtreamSerieEpisode } from '@iptvnator/shared/interfaces';
import { DownloadsService } from '@iptvnator/services';
import { SeasonContainerComponent } from './season-container.component';

// The episodes header's season picker (chips up to four seasons, a menu
// with "N episodes · M watched" rows from five) and the season synopsis
// under it. No season poster renders in either, even when the host passes
// `seasonPosters`. Lives beside season-container.component.spec.ts, which
// sits at the max-lines cap.

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

/** `count` seasons of `perSeason` episodes; ids are season*100 + episode. */
function seasonsOf(
    count: number,
    perSeason = 1
): Record<string, XtreamSerieEpisode[]> {
    const seasons: Record<string, XtreamSerieEpisode[]> = {};
    for (let season = 1; season <= count; season++) {
        seasons[String(season)] = Array.from(
            { length: perSeason },
            (_, index) =>
                createEpisode({
                    id: String(season * 100 + index + 1),
                    episode_num: index + 1,
                    season,
                })
        );
    }
    return seasons;
}

function postersFor(count: number): Record<string, string> {
    const posters: Record<string, string> = {};
    for (let season = 1; season <= count; season++) {
        posters[String(season)] = `https://img.test/season-${season}.jpg`;
    }
    return posters;
}

const watchedPosition = (contentXtreamId: number) => ({
    contentXtreamId,
    contentType: 'episode' as const,
    seriesXtreamId: 20,
    positionSeconds: 100,
    durationSeconds: 100,
    playlistId: 'playlist-1',
});

describe('SeasonContainerComponent season picker', () => {
    let fixture: ComponentFixture<SeasonContainerComponent>;
    let component: SeasonContainerComponent;

    const setRequiredInputs = (
        seasons: Record<string, XtreamSerieEpisode[]>
    ) => {
        fixture.componentRef.setInput('seasons', seasons);
        fixture.componentRef.setInput('seriesId', 20);
        fixture.componentRef.setInput('playlistId', 'playlist-1');
    };

    const query = (selector: string): HTMLElement | null =>
        fixture.nativeElement.querySelector(selector);
    const chips = () =>
        fixture.nativeElement.querySelectorAll(
            '.season-tabs__pill'
        ) as NodeListOf<HTMLButtonElement>;
    const trigger = () =>
        query('[data-testid="season-dropdown"]') as HTMLButtonElement | null;
    const openMenu = (): HTMLButtonElement[] => {
        trigger()?.click();
        fixture.detectChanges();
        return Array.from(
            document.querySelectorAll<HTMLButtonElement>(
                '.season-tabs-menu .mat-mdc-menu-item'
            )
        );
    };
    /** Any season artwork in the header, the synopsis or an open menu. */
    const seasonImages = () => [
        ...Array.from(
            fixture.nativeElement.querySelectorAll(
                'app-detail-section-header img, [data-testid="season-description"] img'
            )
        ),
        ...Array.from(document.querySelectorAll('.season-tabs-menu img')),
    ];

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

        const translate = TestBed.inject(TranslateService);
        translate.setTranslation('en', {
            PORTALS: {
                SEASON_TAB: 'Season {{number}}',
                EPISODE_COUNT_ONE: '1 episode',
                EPISODE_COUNT_OTHER: '{{count}} episodes',
                EPISODES_WATCHED_COUNT: '{{count}} watched',
            },
        });
        translate.use('en');

        fixture = TestBed.createComponent(SeasonContainerComponent);
        component = fixture.componentInstance;
    });

    afterEach(() => fixture.destroy());

    it('shows chips for a three-season show and no season poster', () => {
        fixture.componentRef.setInput('seasonPosters', postersFor(3));
        fixture.componentRef.setInput('seasonDescriptions', {
            '1': 'A season of its own.',
        });
        setRequiredInputs(seasonsOf(3));
        fixture.detectChanges();

        expect(chips()).toHaveLength(3);
        expect(trigger()).toBeNull();
        expect(query('[data-testid="season-description"]')).not.toBeNull();
        expect(seasonImages()).toHaveLength(0);
    });

    it('keeps chips at four seasons and switches to the menu at five', () => {
        setRequiredInputs(seasonsOf(4));
        fixture.detectChanges();
        expect(chips()).toHaveLength(4);
        expect(trigger()).toBeNull();

        setRequiredInputs(seasonsOf(5));
        fixture.detectChanges();
        expect(chips()).toHaveLength(0);
        expect(trigger()).not.toBeNull();
    });

    it('lists "N episodes · M watched" per season in the menu of a twelve-season show', () => {
        fixture.componentRef.setInput('seasonPosters', postersFor(12));
        fixture.componentRef.setInput(
            'playbackPositions',
            new Map([
                [101, watchedPosition(101)],
                [102, watchedPosition(102)],
            ])
        );
        setRequiredInputs(seasonsOf(12, 3));
        fixture.detectChanges();

        expect(trigger()?.textContent).toContain('Season 1');
        const items = openMenu();
        expect(items).toHaveLength(12);

        const countOf = (item: HTMLButtonElement) =>
            item
                .querySelector('[data-testid="season-menu-count"]')
                ?.textContent?.replace(/\s+/g, ' ')
                .trim();
        expect(countOf(items[0])).toBe('3 episodes · 2 watched');
        // Nothing watched: the second half is left out, not "0 watched".
        expect(countOf(items[1])).toBe('3 episodes');
        expect(
            items[0].classList.contains('season-tabs__menu-item--selected')
        ).toBe(true);
        expect(
            items[1].classList.contains('season-tabs__menu-item--selected')
        ).toBe(false);
        expect(seasonImages()).toHaveLength(0);

        items[4].click();
        fixture.detectChanges();
        expect(component.selectedSeason()).toBe('5');
    });

    it('renders no synopsis row for a season without a plot', () => {
        fixture.componentRef.setInput('seasonPosters', postersFor(2));
        fixture.componentRef.setInput('seasonDescriptions', {
            '2': 'A season of its own.',
        });
        setRequiredInputs(seasonsOf(2));
        fixture.detectChanges();

        expect(component.selectedSeason()).toBe('1');
        expect(query('[data-testid="season-description"]')).toBeNull();
        expect(query('.season-strip')).toBeNull();
        expect(seasonImages()).toHaveLength(0);

        chips()[1].click();
        fixture.detectChanges();
        expect(
            query('[data-testid="season-description"]')?.textContent
        ).toContain('A season of its own.');
    });
});
