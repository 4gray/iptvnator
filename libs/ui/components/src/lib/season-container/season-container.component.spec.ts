import { signal, type WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import {
    type InterpolatableTranslationObject,
    TranslateModule,
    TranslateService,
} from '@ngx-translate/core';
import {
    SeasonDownloadCoordinator,
    type EpisodeDownloadCandidate,
    type SeasonEpisodeDownloadAdapter,
} from '@iptvnator/portal/shared/data-access';
import { XtreamSerieEpisode } from '@iptvnator/shared/interfaces';
import {
    DownloadsService,
    type DownloadItem,
    type DownloadStartInput,
} from '@iptvnator/services';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { of } from 'rxjs';
import { EPISODE_INFO_PLAY } from './episode-info-dialog.component';
import { SeasonContainerComponent } from './season-container.component';

interface DownloadsServiceStub {
    readonly isAvailable: WritableSignal<boolean>;
    readonly hasLoadedDownloads: WritableSignal<boolean>;
    readonly downloads: WritableSignal<DownloadItem[]>;
    readonly startDownload: jest.MockedFunction<
        DownloadsService['startDownload']
    >;
    readonly loadDownloads: jest.MockedFunction<
        DownloadsService['loadDownloads']
    >;
    readonly resumeDownload: jest.MockedFunction<
        DownloadsService['resumeDownload']
    >;
    readonly playDownload: jest.MockedFunction<
        DownloadsService['playDownload']
    >;
}

interface Deferred<T> {
    readonly promise: Promise<T>;
    readonly resolve: (value: T) => void;
}

const EN_TRANSLATIONS = JSON.parse(
    readFileSync(
        resolve(process.cwd(), 'apps/web/src/assets/i18n/en.json'),
        'utf8'
    )
) as InterpolatableTranslationObject;

const DOWNLOAD_TRANSLATIONS = {
    DOWNLOADS: EN_TRANSLATIONS['DOWNLOADS'],
};

function createEpisode(
    overrides: Partial<XtreamSerieEpisode> = {}
): XtreamSerieEpisode {
    return {
        id: '101',
        episode_num: 1,
        title: 'Pilot',
        container_extension: 'mp4',
        info: {
            duration: '45 min',
            plot: 'Pilot episode',
            movie_image: 'https://example.com/poster.jpg',
        },
        custom_sid: '',
        added: '',
        season: 1,
        direct_source: '',
        ...overrides,
    };
}

function createDownloadAdapter(): SeasonEpisodeDownloadAdapter {
    return {
        createCandidate(
            episode: XtreamSerieEpisode,
            fallbackSeasonKey: string | undefined
        ): EpisodeDownloadCandidate | null {
            const xtreamId = Number(episode.id);
            const seasonNumber = Number(
                episode.season || fallbackSeasonKey || 1
            );
            const episodeNumber = Number(episode.episode_num);
            if (
                !Number.isSafeInteger(xtreamId) ||
                xtreamId <= 0 ||
                !Number.isSafeInteger(seasonNumber) ||
                seasonNumber <= 0 ||
                !Number.isSafeInteger(episodeNumber) ||
                episodeNumber <= 0
            ) {
                return null;
            }

            const identity = {
                playlistId: 'playlist-1',
                contentType: 'episode' as const,
                xtreamId,
                seriesXtreamId: 20,
                seasonNumber,
                episodeNumber,
            };
            return {
                identity,
                prepare: async (): Promise<DownloadStartInput> => ({
                    ...identity,
                    title: episode.title,
                    url: `https://stream.test/${episode.id}`,
                }),
            };
        },
    };
}

function createDownload(
    episode: XtreamSerieEpisode,
    overrides: Partial<DownloadItem> = {}
): DownloadItem {
    return {
        id: Number(episode.id),
        playlistId: 'playlist-1',
        xtreamId: Number(episode.id),
        contentType: 'episode',
        seriesXtreamId: 20,
        seasonNumber: Number(episode.season || 1),
        episodeNumber: Number(episode.episode_num),
        title: episode.title,
        url: `https://stream.test/${episode.id}`,
        status: 'queued',
        ...overrides,
    };
}

function deferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((resolvePromise) => {
        resolve = resolvePromise;
    });
    return { promise, resolve };
}

const dialogOpen = jest.fn();

describe('SeasonContainerComponent', () => {
    let fixture: ComponentFixture<SeasonContainerComponent>;
    let component: SeasonContainerComponent;
    let downloadsServiceStub: DownloadsServiceStub;
    let downloadAdapter: SeasonEpisodeDownloadAdapter;
    let emittedSeasons: string[];
    const snackBarOpen = jest.fn();

    const setRequiredInputs = (
        seasons: Record<string, XtreamSerieEpisode[]>,
        isLoading = false
    ) => {
        fixture.componentRef.setInput('seasons', seasons);
        fixture.componentRef.setInput('seriesId', 20);
        fixture.componentRef.setInput('playlistId', 'playlist-1');
        fixture.componentRef.setInput('isLoading', isLoading);
    };

    const enableDownloads = (
        adapter: SeasonEpisodeDownloadAdapter | null = downloadAdapter
    ) => {
        downloadsServiceStub.isAvailable.set(true);
        downloadsServiceStub.hasLoadedDownloads.set(true);
        fixture.componentRef.setInput('downloadAdapter', adapter);
    };

    const episodeAction = (episodeId: string | number): HTMLButtonElement => {
        const button = fixture.nativeElement.querySelector(
            `[data-test-id="episode-download-${episodeId}"]`
        ) as HTMLButtonElement | null;
        expect(button).not.toBeNull();
        return button as HTMLButtonElement;
    };

    beforeEach(async () => {
        localStorage.removeItem('iptvnator_episode_view_mode');
        downloadsServiceStub = {
            isAvailable: signal(false),
            hasLoadedDownloads: signal(false),
            downloads: signal<DownloadItem[]>([]),
            startDownload: jest.fn().mockResolvedValue({ success: true }),
            loadDownloads: jest.fn().mockResolvedValue(undefined),
            resumeDownload: jest.fn().mockResolvedValue({ success: true }),
            playDownload: jest.fn().mockResolvedValue({ success: true }),
        };
        downloadAdapter = createDownloadAdapter();
        snackBarOpen.mockReset();
        await TestBed.configureTestingModule({
            imports: [
                NoopAnimationsModule,
                SeasonContainerComponent,
                TranslateModule.forRoot(),
            ],
            providers: [
                {
                    provide: DownloadsService,
                    useValue: downloadsServiceStub,
                },
                {
                    provide: MatDialog,
                    useValue: { open: dialogOpen },
                },
                SeasonDownloadCoordinator,
                {
                    provide: MatSnackBar,
                    useValue: { open: snackBarOpen },
                },
            ],
        }).compileComponents();

        const translate = TestBed.inject(TranslateService);
        translate.setTranslation('en', DOWNLOAD_TRANSLATIONS);
        translate.setDefaultLang('en');
        translate.use('en');

        fixture = TestBed.createComponent(SeasonContainerComponent);
        component = fixture.componentInstance;
        emittedSeasons = [];
        dialogOpen.mockReset();
        dialogOpen.mockReturnValue({ afterClosed: () => of(undefined) });
        component.seasonSelected.subscribe((seasonKey) =>
            emittedSeasons.push(seasonKey)
        );
    });

    afterEach(() => {
        localStorage.removeItem('iptvnator_episode_view_mode');
    });

    it('renders the series-level placeholder when no seasons are available', () => {
        setRequiredInputs({});
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector('.empty-state-panel')
        ).not.toBeNull();
        expect(fixture.nativeElement.textContent).toContain(
            'PORTALS.NO_EPISODES_AVAILABLE'
        );
        expect(
            fixture.nativeElement.querySelector('app-season-tabs')
        ).toBeNull();
    });

    it('renders the loading state instead of the placeholder while seasons are loading', () => {
        setRequiredInputs({}, true);
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector(
                '.loading-container mat-spinner'
            )
        ).not.toBeNull();
        expect(
            fixture.nativeElement.querySelector('.empty-state-panel')
        ).toBeNull();
    });

    it('auto-selects the first season, emits seasonSelected, and renders episodes without a click', () => {
        setRequiredInputs({
            '1': [createEpisode()],
            '2': [],
        });
        fixture.detectChanges();

        expect(component.selectedSeason()).toBe('1');
        expect(emittedSeasons).toEqual(['1']);
        expect(
            fixture.nativeElement.querySelectorAll('.episode-card').length
        ).toBe(1);
        expect(
            fixture.nativeElement.querySelectorAll('.season-tabs__pill').length
        ).toBe(2);
    });

    it('keeps episodes playable while download presentation is disabled', () => {
        downloadsServiceStub.isAvailable.set(true);
        fixture.componentRef.setInput('downloadsEnabled', false);
        setRequiredInputs({ '1': [createEpisode()] });

        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelectorAll('.episode-card').length
        ).toBe(1);
        expect(
            fixture.nativeElement.querySelectorAll(
                '[data-test-id^="episode-download-"]'
            ).length
        ).toBe(0);
    });

    it('renders the season-level placeholder when the selected season has no episodes', () => {
        setRequiredInputs({ '1': [] });
        fixture.detectChanges();

        expect(fixture.nativeElement.textContent).toContain(
            'PORTALS.SEASON_EMPTY'
        );
        expect(fixture.nativeElement.querySelector('.view-toggle')).toBeNull();
    });

    it('switches season via tab click and emits the lazy-load hook once per season', () => {
        setRequiredInputs({
            '1': [createEpisode()],
            '2': [createEpisode({ id: '201', season: 2 })],
        });
        fixture.detectChanges();

        const pills =
            fixture.nativeElement.querySelectorAll('.season-tabs__pill');
        (pills[1] as HTMLButtonElement).click();
        fixture.detectChanges();

        expect(component.selectedSeason()).toBe('2');
        expect(emittedSeasons).toEqual(['1', '2']);
        expect(
            fixture.nativeElement.querySelector('[data-episode-id="201"]')
        ).not.toBeNull();
    });

    it('prefers the inline-playing episode season on auto-select', () => {
        fixture.componentRef.setInput('playingEpisodeId', 201);
        setRequiredInputs({
            '1': [createEpisode()],
            '2': [createEpisode({ id: '201', season: 2 })],
        });
        fixture.detectChanges();

        expect(component.selectedSeason()).toBe('2');
        expect(emittedSeasons).toEqual(['2']);
    });

    it('prefers the most recently updated in-progress episode season over the first season', () => {
        fixture.componentRef.setInput(
            'playbackPositions',
            new Map([
                [
                    201,
                    {
                        contentXtreamId: 201,
                        contentType: 'episode' as const,
                        positionSeconds: 500,
                        durationSeconds: 2700,
                        updatedAt: '2026-07-01T00:00:00.000Z',
                    },
                ],
            ])
        );
        setRequiredInputs({
            '1': [createEpisode()],
            '2': [createEpisode({ id: '201', season: 2 })],
        });
        fixture.detectChanges();

        expect(component.selectedSeason()).toBe('2');
    });

    it('re-resolves a stale selection when the season set changes', () => {
        setRequiredInputs({ '1': [createEpisode()] });
        fixture.detectChanges();
        expect(component.selectedSeason()).toBe('1');

        fixture.componentRef.setInput('seasons', {
            '2': [createEpisode({ id: '201', season: 2 })],
        });
        fixture.detectChanges();

        expect(component.selectedSeason()).toBe('2');
        expect(emittedSeasons).toEqual(['1', '2']);
    });

    it('keeps the user selection when episode data mutates without key changes', () => {
        setRequiredInputs({
            '1': [createEpisode()],
            '2': [],
        });
        fixture.detectChanges();

        const pills =
            fixture.nativeElement.querySelectorAll('.season-tabs__pill');
        (pills[1] as HTMLButtonElement).click();
        fixture.detectChanges();
        expect(component.selectedSeason()).toBe('2');

        // Same keys, new object (e.g. TMDB overlay rebuild) — selection sticks
        fixture.componentRef.setInput('seasons', {
            '1': [createEpisode()],
            '2': [createEpisode({ id: '201', season: 2 })],
        });
        fixture.detectChanges();

        expect(component.selectedSeason()).toBe('2');
        expect(emittedSeasons).toEqual(['1', '2']);
    });

    it('uses a dropdown selector when there are more than six seasons', () => {
        const seasons: Record<string, XtreamSerieEpisode[]> = {};
        for (let index = 1; index <= 7; index++) {
            seasons[String(index)] = [
                createEpisode({ id: String(100 + index), season: index }),
            ];
        }
        setRequiredInputs(seasons);
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector(
                '[data-testid="season-dropdown"]'
            )
        ).not.toBeNull();
        expect(
            fixture.nativeElement.querySelectorAll('.season-tabs__pill').length
        ).toBe(0);
    });

    it('shows the back-to-playing chip only when the playing episode is in another season', () => {
        fixture.componentRef.setInput('playingEpisodeId', 101);
        setRequiredInputs({
            '1': [createEpisode()],
            '2': [createEpisode({ id: '201', season: 2 })],
        });
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector(
                '[data-testid="back-to-playing"]'
            )
        ).toBeNull();

        const pills =
            fixture.nativeElement.querySelectorAll('.season-tabs__pill');
        (pills[1] as HTMLButtonElement).click();
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector(
                '[data-testid="back-to-playing"]'
            )
        ).not.toBeNull();
    });

    it('marks the inline-playing episode card', () => {
        fixture.componentRef.setInput('playingEpisodeId', 101);
        setRequiredInputs({ '1': [createEpisode()] });
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector('.episode-card--playing')
        ).not.toBeNull();
    });

    it('opens the episode info dialog and plays on the dialog play action', () => {
        dialogOpen.mockReturnValue({
            afterClosed: () => of(EPISODE_INFO_PLAY),
        });
        const played: XtreamSerieEpisode[] = [];
        setRequiredInputs({ '1': [createEpisode()] });
        component.episodeClicked.subscribe((episode) => played.push(episode));
        fixture.detectChanges();

        const infoButton = fixture.nativeElement.querySelector(
            '[data-testid="episode-info-button"]'
        ) as HTMLButtonElement;
        expect(infoButton).toBeTruthy();
        infoButton.click();

        expect(dialogOpen).toHaveBeenCalledTimes(1);
        const data = dialogOpen.mock.calls[0][1].data;
        expect(data.episodeLabel).toBe('S01E01');
        expect(data.plot).toBe('Pilot episode');
        expect(played.length).toBe(1);
    });

    it('hides the episode info button when the episode has no plot', () => {
        setRequiredInputs({
            '1': [createEpisode({ info: { duration: '45 min' } as never })],
        });
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector(
                '[data-testid="episode-info-button"]'
            )
        ).toBeNull();
    });

    it('shows list thumbnails only for distinct episode images', () => {
        const withImages = (a: string, b: string) => ({
            '1': [
                createEpisode({ info: { movie_image: a } as never }),
                createEpisode({
                    id: '102',
                    episode_num: 2,
                    info: { movie_image: b } as never,
                }),
            ],
        });
        const query = (selector: string) =>
            fixture.nativeElement.querySelectorAll(selector).length;

        // Distinct stills → thumbnails replace the number square
        setRequiredInputs(withImages('still-1.jpg', 'still-2.jpg'));
        component.setViewMode('list');
        fixture.detectChanges();
        expect(component.listThumbnailsEnabled()).toBe(true);
        expect(query('.episode-list-item__thumb')).toBe(2);
        expect(query('.episode-list-item__number')).toBe(0);

        // Same poster on every episode → number squares stay
        setRequiredInputs(withImages('poster.jpg', 'poster.jpg'));
        fixture.detectChanges();
        expect(component.listThumbnailsEnabled()).toBe(false);
        expect(query('.episode-list-item__thumb')).toBe(0);
        expect(query('.episode-list-item__number')).toBe(2);
    });

    it('renders the season description for the selected season', () => {
        fixture.componentRef.setInput('seasonDescriptions', {
            '1': 'Season one overview',
        });
        setRequiredInputs({ '1': [createEpisode()] });
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector(
                '[data-testid="season-description"]'
            )?.textContent
        ).toContain('Season one overview');
    });

    it('marks only the submitted episode pending synchronously', async () => {
        const first = createEpisode();
        const second = createEpisode({
            id: '102',
            episode_num: 2,
            title: 'Second',
        });
        const start = deferred<{ success: boolean }>();
        downloadsServiceStub.startDownload.mockReturnValue(start.promise);
        enableDownloads();
        setRequiredInputs({ '1': [first, second] });
        fixture.detectChanges();

        episodeAction(101).click();
        fixture.detectChanges();

        expect(episodeAction(101).disabled).toBe(true);
        expect(episodeAction(101).getAttribute('aria-label')).toBe(
            'Pilot is already in the download queue'
        );
        expect(episodeAction(102).disabled).toBe(false);
        expect(episodeAction(102).getAttribute('aria-label')).toBe(
            'Download Second'
        );

        start.resolve({ success: true });
        await Promise.resolve();
        await Promise.resolve();
        await fixture.whenStable();
        fixture.detectChanges();
        expect(episodeAction(101).disabled).toBe(false);
    });

    it('shows the eligible season count before the view toggle and reports skipped rows truthfully', async () => {
        const paused = createEpisode();
        const eligible = createEpisode({
            id: '102',
            episode_num: 2,
            title: 'Second',
        });
        downloadsServiceStub.downloads.set([
            createDownload(paused, { id: 41, status: 'paused' }),
        ]);
        enableDownloads();
        setRequiredInputs({ '1': [paused, eligible] });
        fixture.detectChanges();

        const button = fixture.nativeElement.querySelector(
            '[data-test-id="download-season"]'
        ) as HTMLButtonElement;
        expect(button.textContent).toContain('Download season (1)');
        expect(button.getAttribute('aria-label')).toBe(
            'Download season, 1 episodes available'
        );
        expect(button.nextElementSibling?.classList).toContain('view-toggle');

        button.click();
        await fixture.whenStable();

        expect(downloadsServiceStub.startDownload).toHaveBeenCalledTimes(1);
        expect(snackBarOpen).toHaveBeenCalledWith(
            'Added 1 · Skipped 1',
            undefined,
            { duration: 5000 }
        );
    });

    it('disables the season action until authoritative eligible work exists and while work is in flight', async () => {
        const first = createEpisode();
        enableDownloads();
        downloadsServiceStub.hasLoadedDownloads.set(false);
        setRequiredInputs({ '1': [first] });
        fixture.detectChanges();

        const seasonButton = () =>
            fixture.nativeElement.querySelector(
                '[data-test-id="download-season"]'
            ) as HTMLButtonElement;
        expect(seasonButton().disabled).toBe(true);

        downloadsServiceStub.hasLoadedDownloads.set(true);
        fixture.componentRef.setInput('isLoading', true);
        fixture.detectChanges();
        expect(seasonButton().disabled).toBe(true);

        fixture.componentRef.setInput('isLoading', false);
        fixture.componentRef.setInput('seasons', { '1': [] });
        fixture.detectChanges();
        expect(seasonButton().disabled).toBe(true);

        fixture.componentRef.setInput('seasons', { '1': [first] });
        downloadsServiceStub.downloads.set([
            createDownload(first, { status: 'paused' }),
        ]);
        fixture.detectChanges();
        expect(seasonButton().disabled).toBe(true);

        downloadsServiceStub.downloads.set([]);
        const start = deferred<{ success: boolean }>();
        downloadsServiceStub.startDownload.mockReturnValue(start.promise);
        fixture.detectChanges();
        seasonButton().click();
        fixture.detectChanges();
        expect(seasonButton().disabled).toBe(true);

        start.resolve({ success: true });
        await fixture.whenStable();
    });

    it('announces the season queue action as busy until submission refresh settles', async () => {
        const start = deferred<{ success: boolean }>();
        const refresh = deferred<void>();
        downloadsServiceStub.startDownload.mockReturnValue(start.promise);
        downloadsServiceStub.loadDownloads.mockReturnValue(refresh.promise);
        enableDownloads();
        setRequiredInputs({ '1': [createEpisode()] });
        fixture.detectChanges();

        const seasonButton = () =>
            fixture.nativeElement.querySelector(
                '[data-test-id="download-season"]'
            ) as HTMLButtonElement;
        seasonButton().click();
        fixture.detectChanges();

        expect(seasonButton().textContent).toContain('Adding to queue…');
        expect(seasonButton().getAttribute('aria-label')).toBe(
            'Adding to queue…'
        );
        expect(seasonButton().getAttribute('aria-busy')).toBe('true');

        start.resolve({ success: true });
        await Promise.resolve();
        await Promise.resolve();
        fixture.detectChanges();
        expect(seasonButton().getAttribute('aria-busy')).toBe('true');

        refresh.resolve(undefined);
        await fixture.whenStable();
        fixture.detectChanges();
        expect(seasonButton().hasAttribute('aria-busy')).toBe(false);
        expect(seasonButton().textContent).toContain('Download season (1)');
        expect(seasonButton().getAttribute('aria-label')).toBe(
            'Download season, 1 episodes available'
        );
    });

    it('hides all download presentation on web, in provider-only mode, or without an adapter', () => {
        const first = createEpisode();
        setRequiredInputs({ '1': [first] });
        fixture.componentRef.setInput('downloadAdapter', downloadAdapter);
        fixture.detectChanges();
        expect(
            fixture.nativeElement.querySelector(
                '[data-test-id="download-season"]'
            )
        ).toBeNull();

        downloadsServiceStub.isAvailable.set(true);
        downloadsServiceStub.hasLoadedDownloads.set(true);
        fixture.componentRef.setInput('downloadsEnabled', false);
        fixture.detectChanges();
        expect(
            fixture.nativeElement.querySelector(
                '[data-test-id^="episode-download-"]'
            )
        ).toBeNull();
        expect(
            fixture.nativeElement.querySelector(
                '[data-test-id="download-season"]'
            )
        ).toBeNull();

        fixture.componentRef.setInput('downloadsEnabled', true);
        fixture.componentRef.setInput('downloadAdapter', null);
        fixture.detectChanges();
        expect(
            fixture.nativeElement.querySelector(
                '[data-test-id="download-season"]'
            )
        ).toBeNull();
        expect(
            fixture.nativeElement.querySelector(
                '[data-test-id^="episode-download-"]'
            )
        ).toBeNull();
    });

    it.each(['grid', 'list'] as const)(
        'maps every managed state to the same %s action contract',
        async (viewMode) => {
            const episodes = [
                createEpisode(),
                createEpisode({ id: '102', episode_num: 2, title: 'Queued' }),
                createEpisode({ id: '103', episode_num: 3, title: 'Active' }),
                createEpisode({ id: '104', episode_num: 4, title: 'Paused' }),
                createEpisode({ id: '105', episode_num: 5, title: 'Local' }),
                createEpisode({ id: '106', episode_num: 6, title: 'Unknown' }),
                createEpisode({ id: '107', episode_num: 7, title: 'N/A' }),
                createEpisode({ id: '108', episode_num: 8, title: 'Failed' }),
                createEpisode({ id: '109', episode_num: 9, title: 'Canceled' }),
                createEpisode({ id: '110', episode_num: 10, title: 'Missing' }),
                createEpisode({ id: '111', episode_num: 11, title: 'New' }),
                createEpisode({
                    id: 'invalid',
                    episode_num: 12,
                    title: 'Invalid',
                }),
            ];
            downloadsServiceStub.downloads.set([
                createDownload(episodes[1], { status: 'queued' }),
                createDownload(episodes[2], { status: 'downloading' }),
                createDownload(episodes[3], { status: 'paused' }),
                createDownload(episodes[4], {
                    status: 'completed',
                    fileAvailability: 'available',
                    filePath: '/downloads/local.mp4',
                }),
                createDownload(episodes[5], { status: 'completed' }),
                createDownload(episodes[6], {
                    status: 'completed',
                    fileAvailability: 'not-applicable',
                }),
                createDownload(episodes[7], { status: 'failed' }),
                createDownload(episodes[8], { status: 'canceled' }),
                createDownload(episodes[9], {
                    status: 'completed',
                    fileAvailability: 'missing',
                }),
            ]);
            const start = deferred<{ success: boolean }>();
            downloadsServiceStub.startDownload.mockReturnValue(start.promise);
            enableDownloads();
            setRequiredInputs({ '1': episodes });
            component.setViewMode(viewMode);
            fixture.detectChanges();
            episodeAction(101).click();
            fixture.detectChanges();

            const expected = [
                [
                    101,
                    true,
                    'Pilot is already in the download queue',
                    'downloading',
                ],
                [
                    102,
                    true,
                    'Queued is already in the download queue',
                    'downloading',
                ],
                [
                    103,
                    true,
                    'Active is already in the download queue',
                    'downloading',
                ],
                [104, false, 'Resume Paused', 'play_arrow'],
                [105, false, 'Play Local: Local', 'folder_open'],
                [106, true, 'Download Unknown', 'block'],
                [107, true, 'Download N/A', 'block'],
                [108, false, 'Download Failed', 'download'],
                [109, false, 'Download Canceled', 'download'],
                [110, false, 'Download Missing', 'download'],
                [111, false, 'Download New', 'download'],
                ['invalid', true, 'Download Invalid', 'block'],
            ] as const;
            for (const [id, disabled, aria, icon] of expected) {
                const action = episodeAction(id);
                expect(action.disabled).toBe(disabled);
                expect(action.getAttribute('aria-label')).toBe(aria);
                expect(action.querySelector('mat-icon')?.textContent).toContain(
                    icon
                );
            }

            start.resolve({ success: true });
            await fixture.whenStable();
        }
    );

    it('reuses the selected-season row model across rendering, resume, and local play', async () => {
        const paused = createEpisode();
        const local = createEpisode({
            id: '102',
            episode_num: 2,
            title: 'Local',
        });
        downloadsServiceStub.downloads.set([
            createDownload(paused, { id: 71, status: 'paused' }),
            createDownload(local, {
                id: 72,
                status: 'completed',
                fileAvailability: 'available',
                filePath: '/authorized/downloads/local.mp4',
            }),
        ]);
        const candidateSpy = jest.spyOn(downloadAdapter, 'createCandidate');
        const coordinator = TestBed.inject(SeasonDownloadCoordinator);
        const findDownloadSpy = jest.spyOn(coordinator, 'findDownload');
        enableDownloads();
        setRequiredInputs({ '1': [paused, local] });

        fixture.detectChanges();
        fixture.detectChanges();
        expect(candidateSpy).toHaveBeenCalledTimes(2);
        expect(findDownloadSpy).toHaveBeenCalledTimes(2);

        episodeAction(101).click();
        episodeAction(102).click();
        await fixture.whenStable();
        fixture.detectChanges();

        expect(candidateSpy).toHaveBeenCalledTimes(2);
        expect(findDownloadSpy).toHaveBeenCalledTimes(2);
    });

    it('resumes by managed row id and plays the coordinate-matched local file', async () => {
        const paused = createEpisode();
        const local = createEpisode({
            id: '102',
            episode_num: 2,
            title: 'Local',
        });
        downloadsServiceStub.downloads.set([
            createDownload(paused, {
                id: 71,
                xtreamId: 9001,
                status: 'paused',
            }),
            createDownload(local, {
                id: 72,
                xtreamId: 9002,
                status: 'completed',
                fileAvailability: 'available',
                filePath: '/authorized/downloads/local.mp4',
            }),
        ]);
        enableDownloads();
        setRequiredInputs({ '1': [paused, local] });
        fixture.detectChanges();

        episodeAction(101).click();
        episodeAction(102).click();
        await fixture.whenStable();

        expect(downloadsServiceStub.resumeDownload).toHaveBeenCalledWith(71);
        expect(downloadsServiceStub.playDownload).toHaveBeenCalledWith(
            '/authorized/downloads/local.mp4'
        );
    });

    it('dispatches one submission for rapid duplicate episode clicks without success feedback', async () => {
        const start = deferred<{ success: boolean }>();
        downloadsServiceStub.startDownload.mockReturnValue(start.promise);
        enableDownloads();
        setRequiredInputs({ '1': [createEpisode()] });
        fixture.detectChanges();

        episodeAction(101).click();
        episodeAction(101).click();
        await Promise.resolve();
        await Promise.resolve();

        expect(downloadsServiceStub.startDownload).toHaveBeenCalledTimes(1);
        start.resolve({ success: true });
        await fixture.whenStable();
        expect(snackBarOpen).not.toHaveBeenCalled();
    });

    it('dispatches the selected season only once for rapid duplicate clicks', async () => {
        const start = deferred<{ success: boolean }>();
        downloadsServiceStub.startDownload.mockReturnValue(start.promise);
        enableDownloads();
        setRequiredInputs({ '1': [createEpisode()] });
        fixture.detectChanges();
        const seasonButton = fixture.nativeElement.querySelector(
            '[data-test-id="download-season"]'
        ) as HTMLButtonElement;

        seasonButton.click();
        seasonButton.click();
        await Promise.resolve();
        await Promise.resolve();

        expect(downloadsServiceStub.startDownload).toHaveBeenCalledTimes(1);
        start.resolve({ success: true });
        await fixture.whenStable();
        expect(snackBarOpen).toHaveBeenCalledTimes(1);
    });

    it('shows only the localized generic episode error and no added feedback', async () => {
        downloadsServiceStub.startDownload.mockResolvedValueOnce({
            success: false,
            error: 'https://portal.test?username=alice&password=hunter2',
        });
        enableDownloads();
        setRequiredInputs({ '1': [createEpisode()] });
        fixture.detectChanges();

        episodeAction(101).click();
        await fixture.whenStable();

        expect(snackBarOpen).toHaveBeenCalledWith(
            'The episode could not be added to downloads.',
            undefined,
            { duration: 5000 }
        );
        expect(JSON.stringify(snackBarOpen.mock.calls)).not.toContain('alice');
        expect(JSON.stringify(snackBarOpen.mock.calls)).not.toContain(
            'hunter2'
        );
        expect(JSON.stringify(snackBarOpen.mock.calls)).not.toContain(
            'portal.test'
        );

        snackBarOpen.mockClear();
        downloadsServiceStub.startDownload.mockResolvedValueOnce({
            success: true,
        });
        episodeAction(101).click();
        await fixture.whenStable();
        expect(snackBarOpen).not.toHaveBeenCalled();
    });

    it('snapshots the selected season before asynchronous preparation', async () => {
        const preparation = deferred<void>();
        const first = createEpisode();
        const second = createEpisode({
            id: '102',
            episode_num: 2,
            title: 'Second',
        });
        const delayedAdapter: SeasonEpisodeDownloadAdapter = {
            createCandidate(episode, seasonKey) {
                const candidate = downloadAdapter.createCandidate(
                    episode,
                    seasonKey
                );
                if (!candidate || episode.id !== '101') {
                    return candidate;
                }
                return {
                    ...candidate,
                    prepare: async () => {
                        await preparation.promise;
                        return candidate.prepare();
                    },
                };
            },
        };
        enableDownloads(delayedAdapter);
        setRequiredInputs({
            '1': [first, second],
            '2': [createEpisode({ id: '201', season: 2 })],
        });
        component.selectSeason('1');
        fixture.detectChanges();

        const seasonButton = fixture.nativeElement.querySelector(
            '[data-test-id="download-season"]'
        ) as HTMLButtonElement;
        seasonButton.click();
        component.selectSeason('2');
        fixture.componentRef.setInput('seasons', {
            '1': [createEpisode({ id: '103', title: 'Replacement' })],
            '2': [createEpisode({ id: '201', season: 2 })],
        });
        fixture.detectChanges();
        preparation.resolve(undefined);
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        await fixture.whenStable();

        expect(
            downloadsServiceStub.startDownload.mock.calls.map(
                ([request]) => request.xtreamId
            )
        ).toEqual([101, 102]);
    });

    it('uses the failure aggregate key when any season submission fails', async () => {
        downloadsServiceStub.startDownload
            .mockResolvedValueOnce({ success: true })
            .mockResolvedValueOnce({ success: false, error: 'rejected' });
        enableDownloads();
        setRequiredInputs({
            '1': [
                createEpisode(),
                createEpisode({ id: '102', episode_num: 2 }),
            ],
        });
        fixture.detectChanges();

        (
            fixture.nativeElement.querySelector(
                '[data-test-id="download-season"]'
            ) as HTMLButtonElement
        ).click();
        await fixture.whenStable();

        expect(snackBarOpen).toHaveBeenCalledWith(
            'Added 1 · Skipped 0 · Failed 1',
            undefined,
            { duration: 5000 }
        );
    });
});
