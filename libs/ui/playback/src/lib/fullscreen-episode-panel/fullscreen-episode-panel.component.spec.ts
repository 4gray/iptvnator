import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { FullscreenEpisodePanelComponent } from './fullscreen-episode-panel.component';
import type {
    FullscreenEpisodePanelItem,
    FullscreenEpisodePanelSeason,
} from './fullscreen-episode-panel.util';

function item(
    id: number,
    seasonKey: string,
    episodeNumber: number,
    overrides: Partial<FullscreenEpisodePanelItem> = {}
): FullscreenEpisodePanelItem {
    return {
        id,
        seasonKey,
        episodeNumber,
        label: `S0${seasonKey}E0${episodeNumber}`,
        title: `Episode ${episodeNumber}`,
        thumbnailUrl: null,
        overview: '',
        durationLabel: null,
        progressPercent: null,
        watched: false,
        isPlaying: false,
        episode: { id: String(id) },
        ...overrides,
    };
}

function seasons(playingId: number | null): FullscreenEpisodePanelSeason[] {
    return [
        {
            key: '1',
            loadState: 'loaded',
            episodes: [
                item(11, '1', 1, {
                    isPlaying: playingId === 11,
                    watched: true,
                    progressPercent: 100,
                }),
                item(12, '1', 2, {
                    isPlaying: playingId === 12,
                    thumbnailUrl: 'https://img.test/12.jpg',
                    overview: 'A rescue signal.',
                    durationLabel: '45 min',
                    progressPercent: 30,
                }),
            ],
        },
        {
            key: '2',
            loadState: 'loaded',
            episodes: [item(21, '2', 1, { isPlaying: playingId === 21 })],
        },
        { key: '3', loadState: 'loading', episodes: [] },
    ];
}

describe('FullscreenEpisodePanelComponent', () => {
    let fixture: ComponentFixture<FullscreenEpisodePanelComponent>;
    let component: FullscreenEpisodePanelComponent;

    const rows = (): HTMLButtonElement[] =>
        Array.from(
            fixture.nativeElement.querySelectorAll(
                '[data-test-id="fullscreen-episode-panel-episode"]'
            )
        );
    const pills = (): HTMLButtonElement[] =>
        Array.from(
            fixture.nativeElement.querySelectorAll('.season-tabs__pill')
        );

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [
                FullscreenEpisodePanelComponent,
                NoopAnimationsModule,
                TranslateModule.forRoot(),
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(FullscreenEpisodePanelComponent);
        component = fixture.componentInstance;
    });

    afterEach(() => fixture.destroy());

    it('opens on the playing episode’s season and renders its rows with still, fallback numeral, marker and progress', () => {
        fixture.componentRef.setInput('seasons', seasons(12));
        fixture.detectChanges();

        expect(component.selectedSeasonKey()).toBe('1');
        expect(
            pills().map((pill) => pill.getAttribute('aria-selected'))
        ).toEqual(['true', 'false', 'false']);
        const [first, second] = rows();
        expect(rows()).toHaveLength(2);
        // No still: the numeral tile stands in.
        expect(
            first.querySelector('.episode-panel__number')?.textContent?.trim()
        ).toBe('1');
        expect(first.querySelector('.episode-panel__watched')).not.toBeNull();
        expect(first.getAttribute('aria-current')).toBeNull();
        // Still, overview, runtime, marker and progress on the playing row.
        expect(
            second.querySelector<HTMLImageElement>('.episode-panel__still')?.src
        ).toBe('https://img.test/12.jpg');
        expect(second.getAttribute('aria-current')).toBe('true');
        expect(
            second.querySelector('.episode-panel__playing-badge')
        ).not.toBeNull();
        expect(
            second
                .querySelector('.episode-panel__overview')
                ?.textContent?.trim()
        ).toBe('A rescue signal.');
        expect(
            second
                .querySelector('.episode-panel__duration')
                ?.textContent?.trim()
        ).toBe('45 min');
        expect(
            second.querySelector<HTMLElement>('.episode-panel__progress-bar')
                ?.style.width
        ).toBe('30%');
        // A watched playing row shows the marker, not the check.
        expect(second.querySelector('.episode-panel__watched')).toBeNull();
    });

    it('falls back to the numeral tile when a still fails to load', () => {
        fixture.componentRef.setInput('seasons', seasons(12));
        fixture.detectChanges();

        const playingRow = rows()[1];
        expect(
            playingRow.querySelector('.episode-panel__still')
        ).not.toBeNull();
        playingRow
            .querySelector('.episode-panel__still')
            ?.dispatchEvent(new Event('error'));
        fixture.detectChanges();

        expect(playingRow.querySelector('.episode-panel__still')).toBeNull();
        expect(
            playingRow
                .querySelector('.episode-panel__number')
                ?.textContent?.trim()
        ).toBe('2');
    });

    it('emits a picked episode but ignores a click on the playing one', () => {
        const picked: FullscreenEpisodePanelItem[] = [];
        fixture.componentRef.setInput('seasons', seasons(12));
        component.episodeSelected.subscribe((picked_) => picked.push(picked_));
        fixture.detectChanges();

        const [first, second] = rows();
        second.click();
        expect(picked).toEqual([]);
        first.click();
        expect(picked.map((row) => row.id)).toEqual([11]);
    });

    it('switches seasons from the tabs, relays the pick to the host and offers the way back to the playing episode', () => {
        const selected: string[] = [];
        fixture.componentRef.setInput('seasons', seasons(12));
        component.seasonSelected.subscribe((key) => selected.push(key));
        fixture.detectChanges();

        pills()[1].click();
        fixture.detectChanges();
        expect(selected).toEqual(['2']);
        expect(component.selectedSeasonKey()).toBe('2');
        expect(rows().map((row) => row.dataset.episodeId)).toEqual(['21']);

        const back = fixture.nativeElement.querySelector(
            '[data-testid="back-to-playing"]'
        ) as HTMLButtonElement;
        expect(back).not.toBeNull();
        back.click();
        fixture.detectChanges();
        expect(component.selectedSeasonKey()).toBe('1');
        // Coming back is a local move, not a host selection.
        expect(selected).toEqual(['2']);
    });

    it('shows the season strip with poster, name and count, follows the tab and folds on a dead image', () => {
        const translate = TestBed.inject(TranslateService);
        translate.setTranslation('en', {
            PORTALS: { SEASON_TAB: 'Season {{number}}' },
            DOWNLOADS: {
                EPISODE_COUNT_ONE: '1 episode',
                EPISODE_COUNT_OTHER: '{{count}} episodes',
            },
        });
        translate.use('en');
        const withPosters = seasons(12).map((season) =>
            season.key === '1'
                ? { ...season, posterUrl: 'https://img.test/season-1.jpg' }
                : season
        );
        fixture.componentRef.setInput('seasons', withPosters);
        fixture.detectChanges();

        const strip = () =>
            fixture.nativeElement.querySelector(
                '[data-test-id="fullscreen-episode-panel-season"]'
            ) as HTMLElement | null;
        expect(
            strip()?.querySelector<HTMLImageElement>(
                '.episode-panel__season-poster'
            )?.src
        ).toBe('https://img.test/season-1.jpg');
        expect(
            strip()
                ?.querySelector('.episode-panel__season-name')
                ?.textContent?.trim()
        ).toBe('Season 1');
        expect(
            strip()
                ?.querySelector('.episode-panel__season-count')
                ?.textContent?.trim()
        ).toBe('2 episodes');

        // Season two has no poster: the strip is withheld, tabs stay.
        pills()[1].click();
        fixture.detectChanges();
        expect(strip()).toBeNull();
        expect(pills()).toHaveLength(3);

        pills()[0].click();
        fixture.detectChanges();
        strip()
            ?.querySelector('.episode-panel__season-poster')
            ?.dispatchEvent(new Event('error'));
        fixture.detectChanges();
        expect(strip()).toBeNull();
    });

    it('withholds the season strip for a one-season series', () => {
        const [first] = seasons(12);
        fixture.componentRef.setInput('seasons', [
            { ...first, posterUrl: 'https://img.test/season-1.jpg' },
        ]);
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector(
                '[data-test-id="fullscreen-episode-panel-season"]'
            )
        ).toBeNull();
        expect(rows()).toHaveLength(2);
    });

    it('shows a pending season as loading and a loaded empty season as empty', () => {
        fixture.componentRef.setInput('seasons', seasons(12));
        fixture.detectChanges();

        pills()[2].click();
        fixture.detectChanges();
        expect(
            fixture.nativeElement.querySelector(
                '[data-test-id="fullscreen-episode-panel-loading"]'
            )
        ).not.toBeNull();

        fixture.componentRef.setInput('seasons', [
            ...seasons(12).slice(0, 2),
            { key: '3', loadState: 'loaded', episodes: [] },
        ]);
        fixture.detectChanges();
        expect(
            fixture.nativeElement.querySelector(
                '[data-test-id="fullscreen-episode-panel-empty"]'
            )
        ).not.toBeNull();
        expect(rows()).toHaveLength(0);
    });

    it('offers a retry for an unanswered season, since the tabs never re-emit the selected key', () => {
        const selected: string[] = [];
        fixture.componentRef.setInput('seasons', [
            ...seasons(12).slice(0, 2),
            { key: '3', loadState: 'unloaded', episodes: [] },
        ]);
        component.seasonSelected.subscribe((key) => selected.push(key));
        fixture.detectChanges();

        pills()[2].click();
        fixture.detectChanges();
        expect(selected).toEqual(['3']);
        expect(
            fixture.nativeElement.querySelector(
                '[data-test-id="fullscreen-episode-panel-loading"]'
            )
        ).toBeNull();

        pills()[2].click();
        expect(selected).toEqual(['3']);
        const retry = fixture.nativeElement.querySelector(
            '[data-test-id="fullscreen-episode-panel-retry"]'
        ) as HTMLButtonElement;
        retry.click();
        expect(selected).toEqual(['3', '3']);
    });

    it('keeps the rows as buttons inside list items', () => {
        fixture.componentRef.setInput('seasons', seasons(12));
        fixture.detectChanges();

        const list = fixture.nativeElement.querySelector(
            '[data-test-id="fullscreen-episode-panel-list"]'
        ) as HTMLElement;
        expect(list.tagName).toBe('UL');
        for (const row of rows()) {
            expect(row.tagName).toBe('BUTTON');
            expect(row.getAttribute('role')).toBeNull();
            expect(row.parentElement?.tagName).toBe('LI');
        }
    });

    it('keeps the user’s tab through progress rebuilds but follows playback into another season', () => {
        fixture.componentRef.setInput('seasons', seasons(12));
        fixture.detectChanges();
        pills()[1].click();
        fixture.detectChanges();
        expect(component.selectedSeasonKey()).toBe('2');

        // A progress tick rebuilds the season objects; same playing season.
        fixture.componentRef.setInput('seasons', seasons(12));
        fixture.detectChanges();
        expect(component.selectedSeasonKey()).toBe('2');

        // Autoplay carried playback into season 2 while the user looked at
        // season 1: the tab jumps to the episode on screen.
        pills()[0].click();
        fixture.detectChanges();
        expect(component.selectedSeasonKey()).toBe('1');
        fixture.componentRef.setInput('seasons', seasons(21));
        fixture.detectChanges();
        expect(component.selectedSeasonKey()).toBe('2');
    });

    it('centers the playing row in the list when the panel opens, without touching the page', () => {
        fixture.componentRef.setInput('seasons', seasons(12));
        fixture.componentRef.setInput('open', false);
        fixture.detectChanges();

        const list = fixture.nativeElement.querySelector(
            '[data-test-id="fullscreen-episode-panel-list"]'
        ) as HTMLElement;
        const playingRow = rows()[1];
        Object.defineProperty(list, 'clientHeight', { value: 400 });
        Object.defineProperty(playingRow, 'offsetTop', { value: 900 });
        Object.defineProperty(playingRow, 'offsetHeight', { value: 100 });
        expect(list.scrollTop).toBe(0);

        fixture.componentRef.setInput('open', true);
        fixture.detectChanges();
        // 900 - 400 / 2 + 100 / 2
        expect(list.scrollTop).toBe(750);

        // The user scrolls away; a progress rebuild must not drag them back.
        list.scrollTop = 0;
        fixture.componentRef.setInput('seasons', seasons(12));
        fixture.detectChanges();
        expect(list.scrollTop).toBe(0);
    });
});
