import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import type { DownloadItem } from '@iptvnator/services';
import type {
    DownloadLibraryEntity,
    DownloadSeriesCardViewModel,
} from './download-library.viewmodel';
import { DownloadLibraryComponent } from './download-library.component';

const TRANSLATIONS = {
    DOWNLOADS: {
        ARTWORK_UNAVAILABLE: 'Artwork unavailable',
        COPY_URL: 'Copy download URL',
        EPISODE: 'Episode',
        EPISODE_COUNT_ONE: '1 episode',
        EPISODE_COUNT_OTHER: '{{count}} episodes',
        MORE_ACTIONS: 'More actions',
        MOVIE: 'Movie',
        OFFLINE: 'Offline',
        OPEN_ARTWORK: 'Open details: {{title}} artwork',
        OPEN_DETAILS: 'Open details',
        OPEN_EPISODES: 'Open downloaded episodes',
        PLAY: 'Play',
        READY_TO_WATCH: 'Ready to watch',
        REMOVE_FROM_MANAGER: 'Remove from manager',
        REVEAL: 'Show in folder',
        SEASON: 'Season {{season}}',
        SEASON_RANGE: 'Seasons {{first}}–{{last}}',
        SERIES: 'Series',
    },
    PORTALS: {
        MULTI_SOURCE: {
            SOURCE: 'Source',
        },
    },
};

function item(overrides: Partial<DownloadItem>): DownloadItem {
    return {
        id: 1,
        playlistId: 'playlist-a',
        xtreamId: 101,
        contentType: 'vod',
        title: 'Download',
        url: 'https://media.example.test/download',
        status: 'completed',
        bytesDownloaded: 2_500_000,
        ...overrides,
    };
}

const MOVIE = item({
    id: 9,
    title: 'Moonrise',
    posterUrl: 'https://media.example.test/moonrise.jpg',
});
const SERIES_MEMBERS = [
    item({
        id: 11,
        xtreamId: 201,
        contentType: 'episode',
        seriesXtreamId: 77,
        seasonNumber: 1,
        episodeNumber: 2,
        title: 'Northwind - S01E02 - Harbour',
    }),
    item({
        id: 12,
        xtreamId: 202,
        contentType: 'episode',
        seriesXtreamId: 77,
        seasonNumber: 1,
        episodeNumber: 5,
        title: 'Northwind - S01E05 - Crossing',
    }),
    item({
        id: 13,
        xtreamId: 203,
        contentType: 'episode',
        seriesXtreamId: 77,
        seasonNumber: 2,
        episodeNumber: 1,
        title: 'Northwind - S02E01 - Return',
    }),
] as const;
const SERIES: DownloadSeriesCardViewModel = {
    kind: 'series',
    key: 'series:playlist-a:77',
    representative: SERIES_MEMBERS[2],
    members: SERIES_MEMBERS,
    seriesXtreamId: 77,
    title: 'Northwind',
    posterUrl: 'https://media.example.test/northwind.jpg',
    newestTimestamp: 3,
    sourceName: 'Living room',
    trackedBytes: 7_500_000,
    firstSeason: 1,
    lastSeason: 2,
};
const FALLBACK_EPISODE = item({
    id: 21,
    xtreamId: 301,
    contentType: 'episode',
    seriesXtreamId: undefined,
    seasonNumber: 2,
    episodeNumber: 4,
    title: 'Legacy episode',
    posterUrl: 'https://media.example.test/broken.jpg',
});
const ENTITIES: readonly DownloadLibraryEntity[] = [
    {
        kind: 'movie',
        key: 'movie:9',
        item: MOVIE,
        newestTimestamp: 4,
        sourceName: 'Cinema',
        trackedBytes: 2_500_000,
    },
    SERIES,
    {
        kind: 'episode',
        key: 'episode:21',
        item: FALLBACK_EPISODE,
        newestTimestamp: 2,
        sourceName: 'Archive',
        trackedBytes: 2_500_000,
        episodeLabel: 'S02E04',
    },
];

describe('DownloadLibraryComponent', () => {
    let fixture: ComponentFixture<DownloadLibraryComponent>;
    let component: DownloadLibraryComponent;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [
                DownloadLibraryComponent,
                NoopAnimationsModule,
                TranslateModule.forRoot(),
            ],
        }).compileComponents();

        TestBed.inject(TranslateService).setTranslation('en', TRANSLATIONS);
        TestBed.inject(TranslateService).use('en');
        fixture = TestBed.createComponent(DownloadLibraryComponent);
        component = fixture.componentInstance;
        fixture.componentRef.setInput('entities', ENTITIES);
        await fixture.whenStable();
    });

    afterEach(() => {
        document
            .querySelectorAll('.cdk-overlay-container')
            .forEach((element) => element.remove());
    });

    function byTestId(testId: string): HTMLElement {
        const element = fixture.nativeElement.querySelector(
            `[data-test-id="${testId}"]`
        ) as HTMLElement | null;
        if (!element) {
            throw new Error(`Missing element: ${testId}`);
        }
        return element;
    }

    function button(container: ParentNode, label: string): HTMLButtonElement {
        const element = Array.from(container.querySelectorAll('button')).find(
            (candidate) => candidate.getAttribute('aria-label') === label
        );
        if (!element) {
            throw new Error(`Missing button: ${label}`);
        }
        return element as HTMLButtonElement;
    }

    async function click(element: HTMLElement): Promise<void> {
        element.click();
        await fixture.whenStable();
    }

    async function clickMenuAction(
        card: HTMLElement,
        triggerLabel: string,
        actionLabel: string
    ): Promise<void> {
        await click(button(card, triggerLabel));
        await click(button(document, actionLabel));
    }

    it('renders movie, grouped-series, and fallback-episode identities', () => {
        const section = byTestId('downloads-library-section');
        expect(section.getAttribute('aria-labelledby')).toBe(
            'downloads-library-heading'
        );
        expect(
            section.querySelector('#downloads-library-heading')?.textContent
        ).toContain('Ready to watch');
        const movieCard = byTestId('download-library-movie-9');
        const seriesCard = byTestId('download-library-series-playlist-a-77');
        const fallbackEpisodeCard = byTestId('download-library-episode-21');

        expect(movieCard.getAttribute('data-test-id')).toBe(
            'download-library-movie-9'
        );
        expect(movieCard.textContent).toContain('Moonrise');
        expect(seriesCard.textContent).toContain('3 episodes');
        expect(seriesCard.textContent).toContain('Seasons 1–2');
        expect(fallbackEpisodeCard.textContent).toContain('S02E04');
        expect(fallbackEpisodeCard.textContent).toContain('Episode');
    });

    it('keeps ready cards clean while preserving tracked size', () => {
        const section = byTestId('downloads-library-section');
        const movieCard = byTestId('download-library-movie-9');
        const seriesCard = byTestId('download-library-series-playlist-a-77');
        const episodeCard = byTestId('download-library-episode-21');

        expect(section.textContent).not.toContain('Offline');
        expect(movieCard.textContent).not.toContain('Cinema');
        expect(seriesCard.textContent).not.toContain('Living room');
        expect(episodeCard.textContent).not.toContain('Archive');
        expect(movieCard.textContent).toContain('2.4 MB');
    });

    it('puts the movie source ahead of its overflow commands', async () => {
        const card = byTestId('download-library-movie-9');

        await click(button(card, 'More actions: Moonrise'));

        const header = document.querySelector<HTMLElement>(
            '.download-source-menu-header'
        );
        const copy = button(document, 'Copy download URL: Moonrise');
        const remove = button(document, 'Remove from manager: Moonrise');
        expect(header?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
            'Source Cinema'
        );
        expect(
            header &&
                header.compareDocumentPosition(copy) &
                    Node.DOCUMENT_POSITION_FOLLOWING
        ).toBeTruthy();
        expect(
            copy.compareDocumentPosition(remove) &
                Node.DOCUMENT_POSITION_FOLLOWING
        ).toBeTruthy();
    });

    it('opens downloaded episodes from the series overflow without a file action', async () => {
        const card = byTestId('download-library-series-playlist-a-77');
        const episodeGroups: DownloadSeriesCardViewModel[] = [];
        const actions: unknown[] = [];
        component.episodesOpened.subscribe((group) =>
            episodeGroups.push(group)
        );
        component.itemAction.subscribe((action) => actions.push(action));

        await click(button(card, 'More actions: Northwind'));

        const header = document.querySelector<HTMLElement>(
            '.download-source-menu-header'
        );
        expect(header?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
            'Source Living room'
        );
        await click(button(document, 'Open downloaded episodes: Northwind'));

        expect(episodeGroups).toEqual([SERIES]);
        expect(actions).toEqual([]);
    });

    it('omits the named library section when no completed entity is visible', async () => {
        fixture.componentRef.setInput('entities', []);
        await fixture.whenStable();

        expect(
            fixture.nativeElement.querySelector(
                '[data-test-id="downloads-library-section"]'
            )
        ).toBeNull();
    });

    it('uses a singular episode count for a one-file series group', async () => {
        fixture.componentRef.setInput('entities', [
            {
                ...SERIES,
                members: [SERIES_MEMBERS[0]],
                representative: SERIES_MEMBERS[0],
            },
        ]);
        await fixture.whenStable();

        expect(
            byTestId('download-library-series-playlist-a-77').textContent
        ).toContain('1 episode');
    });

    it('opens movie details from artwork and title without playing locally', async () => {
        const card = byTestId('download-library-movie-9');
        const opened: DownloadItem[] = [];
        const actions: unknown[] = [];
        component.openRequested.subscribe((selected) => opened.push(selected));
        component.itemAction.subscribe((action) => actions.push(action));

        await click(button(card, 'Open details: Moonrise artwork'));
        await click(button(card, 'Open details: Moonrise'));

        expect(opened).toEqual([MOVIE, MOVIE]);
        expect(actions).toEqual([]);
    });

    it('opens orphaned movie details without source-dependent disabled semantics', async () => {
        const card = byTestId('download-library-movie-9');
        const artwork = button(card, 'Open details: Moonrise artwork');
        const title = button(card, 'Open details: Moonrise');
        const opened: DownloadItem[] = [];
        component.openRequested.subscribe((item) => opened.push(item));

        expect(artwork.disabled).toBe(false);
        expect(title.disabled).toBe(false);
        expect(artwork.getAttribute('aria-disabled')).toBeNull();
        expect(title.getAttribute('aria-disabled')).toBeNull();

        await click(artwork);
        await click(title);
        expect(opened).toEqual([MOVIE, MOVIE]);
    });

    it('keeps explicit movie toolbar and menu commands local', async () => {
        const card = byTestId('download-library-movie-9');
        const actions: unknown[] = [];
        const toolbar = card.querySelector(
            '.download-library__actions'
        ) as HTMLElement;
        component.itemAction.subscribe((action) => actions.push(action));

        await click(button(toolbar, 'Play: Moonrise'));
        await click(button(card, 'Show in folder: Moonrise'));
        await clickMenuAction(
            card,
            'More actions: Moonrise',
            'Copy download URL: Moonrise'
        );
        await clickMenuAction(
            card,
            'More actions: Moonrise',
            'Remove from manager: Moonrise'
        );

        expect(actions).toEqual([
            { type: 'play', item: MOVIE },
            { type: 'reveal', item: MOVIE },
            { type: 'copy-url', item: MOVIE },
            { type: 'remove', item: MOVIE },
        ]);
    });

    it('opens grouped-series details from both real navigation buttons', async () => {
        const card = byTestId('download-library-series-playlist-a-77');
        const opened: DownloadItem[] = [];
        component.openRequested.subscribe((selected) => opened.push(selected));

        const artwork = button(card, 'Open details: Northwind artwork');
        const title = button(card, 'Open details: Northwind');
        expect(artwork.tagName).toBe('BUTTON');
        expect(title.tagName).toBe('BUTTON');

        artwork.focus();
        expect(document.activeElement).toBe(artwork);
        await click(artwork);
        await click(title);

        expect(opened).toEqual([SERIES.representative, SERIES.representative]);
    });

    it('disables pending grouped-series navigation without blocking local episodes', async () => {
        fixture.componentRef.setInput(
            'pendingIds',
            new Set([SERIES.representative.id])
        );
        await fixture.whenStable();
        const card = byTestId('download-library-series-playlist-a-77');
        const artwork = button(card, 'Open details: Northwind artwork');
        const title = button(card, 'Open details: Northwind');
        const episodes = button(card, 'Open downloaded episodes: Northwind');
        const opened: DownloadItem[] = [];
        const episodeGroups: DownloadSeriesCardViewModel[] = [];
        component.openRequested.subscribe((item) => opened.push(item));
        component.episodesOpened.subscribe((group) =>
            episodeGroups.push(group)
        );

        expect(artwork.disabled).toBe(true);
        expect(title.disabled).toBe(true);
        expect(episodes.disabled).toBe(false);

        artwork.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        title.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await fixture.whenStable();
        expect(opened).toEqual([]);

        await click(
            button(
                byTestId('download-library-movie-9'),
                'Open details: Moonrise artwork'
            )
        );
        expect(opened).toEqual([MOVIE]);

        await click(episodes);
        expect(episodeGroups).toEqual([SERIES]);
    });

    it('opens orphaned series navigation while keeping episodes local', async () => {
        const card = byTestId('download-library-series-playlist-a-77');
        const artwork = button(card, 'Open details: Northwind artwork');
        const title = button(card, 'Open details: Northwind');
        const episodes = button(card, 'Open downloaded episodes: Northwind');
        const opened: DownloadItem[] = [];
        component.openRequested.subscribe((item) => opened.push(item));

        expect(artwork.disabled).toBe(false);
        expect(title.disabled).toBe(false);
        expect(artwork.getAttribute('aria-disabled')).toBeNull();
        expect(title.getAttribute('aria-disabled')).toBeNull();
        expect(episodes.disabled).toBe(false);

        artwork.focus();
        expect(document.activeElement).toBe(artwork);

        await click(artwork);
        await click(title);
        expect(opened).toEqual([SERIES.representative, SERIES.representative]);
    });

    it('opens the downloaded episode group from its count control', async () => {
        const opened: DownloadSeriesCardViewModel[] = [];
        component.episodesOpened.subscribe((group) => opened.push(group));

        await click(
            button(
                byTestId('download-library-series-playlist-a-77'),
                'Open downloaded episodes: Northwind'
            )
        );

        expect(opened).toEqual([SERIES]);
    });

    it('keeps an invalid-series episode local without series navigation', async () => {
        const card = byTestId('download-library-episode-21');
        const itemActions: unknown[] = [];
        const opened: DownloadItem[] = [];
        component.itemAction.subscribe((action) => itemActions.push(action));
        component.openRequested.subscribe((selected) => opened.push(selected));

        expect(
            card.querySelector('[data-test-id="download-library-series-open"]')
        ).toBeNull();
        const artwork = card.querySelector(
            '.download-library__artwork-button'
        ) as HTMLButtonElement;
        const title = card.querySelector(
            '.download-library__title-button'
        ) as HTMLButtonElement;

        expect(artwork.getAttribute('aria-label')).toBe('Play: Legacy episode');
        expect(title.getAttribute('aria-label')).toBe('Play: Legacy episode');
        await click(artwork);
        await click(title);

        expect(itemActions).toEqual([
            { type: 'play', item: FALLBACK_EPISODE },
            { type: 'play', item: FALLBACK_EPISODE },
        ]);
        expect(opened).toEqual([]);
    });

    it('disables every local command while the concrete item is pending', async () => {
        fixture.componentRef.setInput('pendingIds', new Set([9, 21]));
        await fixture.whenStable();

        for (const testId of [
            'download-library-movie-9',
            'download-library-episode-21',
        ]) {
            const card = byTestId(testId);
            expect(
                Array.from(card.querySelectorAll('button')).every(
                    (candidate) => candidate.disabled
                )
            ).toBe(true);
        }
    });

    it('replaces broken artwork with one semantic placeholder', async () => {
        const card = byTestId('download-library-episode-21');
        const image = card.querySelector('img') as HTMLImageElement;

        image.dispatchEvent(new Event('error'));
        await fixture.whenStable();

        expect(card.querySelector('img')).toBeNull();
        const placeholders = card.querySelectorAll(
            '[role="img"][aria-label="Artwork unavailable: Legacy episode"]'
        );
        expect(placeholders).toHaveLength(1);
    });

    it('uses the shared cover-grid sizing contract', () => {
        const styles = readFileSync(
            join(__dirname, 'download-library.component.scss'),
            'utf8'
        );

        expect(styles).toContain('var(--cover-grid-min-width, 148px)');
        expect(styles).toContain('var(--cover-gap, 16px)');
        expect(styles).not.toContain(
            'grid-template-columns: repeat(2, minmax(0, 1fr))'
        );
    });
});
