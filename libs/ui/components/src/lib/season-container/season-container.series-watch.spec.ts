import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import {
    type InterpolatableTranslationObject,
    TranslateModule,
    TranslateService,
} from '@ngx-translate/core';
import { SeasonDownloadCoordinator } from '@iptvnator/portal/shared/data-access';
import { XtreamSerieEpisode } from '@iptvnator/shared/interfaces';
import { DownloadsService } from '@iptvnator/services';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { of } from 'rxjs';
import { SeasonContainerComponent } from './season-container.component';
import { type SeasonContainerSeriesPlaybackToggleRequest } from './season-watch-toggle.util';

// Series-scope coverage for the season-header ⋮ menu. The season-scope
// toggle cases live in season-container.component.spec.ts, which sits at
// the max-lines cap.

const EN_TRANSLATIONS = JSON.parse(
    readFileSync(
        resolve(process.cwd(), 'apps/web/src/assets/i18n/en.json'),
        'utf8'
    )
) as InterpolatableTranslationObject;

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
        season: 0,
        direct_source: '',
        ...overrides,
    } as XtreamSerieEpisode;
}

const watchedPosition = (contentXtreamId: number) => ({
    contentXtreamId,
    contentType: 'episode' as const,
    seriesXtreamId: 20,
    positionSeconds: 100,
    durationSeconds: 100,
    playlistId: 'playlist-1',
});

describe('SeasonContainerComponent series watched toggle', () => {
    let fixture: ComponentFixture<SeasonContainerComponent>;
    let component: SeasonContainerComponent;
    let emitted: SeasonContainerSeriesPlaybackToggleRequest[];

    const twoSeasons = () => ({
        '1': [
            createEpisode({ id: '101', episode_num: 1 }),
            createEpisode({ id: '102', episode_num: 2 }),
        ],
        '2': [createEpisode({ id: '201', episode_num: 1 })],
    });

    const setRequiredInputs = (
        seasons: Record<string, XtreamSerieEpisode[]>,
        playlistId = 'playlist-1'
    ) => {
        fixture.componentRef.setInput('seasons', seasons);
        fixture.componentRef.setInput('seriesId', 20);
        fixture.componentRef.setInput('playlistId', playlistId);
    };

    const menuTrigger = (): HTMLButtonElement | null =>
        fixture.nativeElement.querySelector(
            '[data-test-id="series-watch-menu"]'
        );

    const openSeriesMenuItem = (): HTMLButtonElement => {
        const trigger = menuTrigger();
        expect(trigger).not.toBeNull();
        trigger?.click();
        fixture.detectChanges();
        const item = document.querySelector(
            '[data-test-id="toggle-series-watched"]'
        ) as HTMLButtonElement | null;
        expect(item).not.toBeNull();
        return item as HTMLButtonElement;
    };

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
            XTREAM: EN_TRANSLATIONS['XTREAM'],
        } as InterpolatableTranslationObject);
        translate.setDefaultLang('en');
        translate.use('en');

        fixture = TestBed.createComponent(SeasonContainerComponent);
        component = fixture.componentInstance;
        emitted = [];
        component.seriesPlaybackToggleRequested.subscribe((request) =>
            emitted.push(request)
        );
    });

    it('hides the menu without a playlist id or without seasons', () => {
        setRequiredInputs(twoSeasons(), '');
        fixture.detectChanges();
        expect(menuTrigger()).toBeNull();

        setRequiredInputs({});
        fixture.detectChanges();
        expect(menuTrigger()).toBeNull();

        // Loaded-but-empty seasons only count with the unloaded marker.
        setRequiredInputs({ '1': [] });
        fixture.detectChanges();
        expect(menuTrigger()).toBeNull();

        fixture.componentRef.setInput('hasUnloadedSeasons', true);
        fixture.detectChanges();
        expect(menuTrigger()).not.toBeNull();
    });

    it('marks every unwatched episode across seasons, excluding the playing one', () => {
        setRequiredInputs(twoSeasons());
        fixture.componentRef.setInput(
            'playbackPositions',
            new Map([[101, watchedPosition(101)]])
        );
        fixture.componentRef.setInput('playingEpisodeId', 102);
        fixture.detectChanges();

        const item = openSeriesMenuItem();
        // 3 episodes − 1 watched − 1 playing = 1 markable.
        expect(item.textContent).toContain('Mark series as watched (1)');
        item.click();

        expect(emitted).toEqual([
            {
                markWatched: true,
                requests: [
                    {
                        contentXtreamId: 201,
                        nextPosition: expect.objectContaining({
                            contentXtreamId: 201,
                            seasonNumber: 2,
                            seriesXtreamId: 20,
                            playlistId: 'playlist-1',
                        }),
                    },
                ],
            },
        ]);
    });

    it('flips to unwatch-all when every season is watched and clears the playing episode too', () => {
        setRequiredInputs(twoSeasons());
        fixture.componentRef.setInput(
            'playbackPositions',
            new Map([
                [101, watchedPosition(101)],
                [102, watchedPosition(102)],
                [201, watchedPosition(201)],
            ])
        );
        fixture.componentRef.setInput('playingEpisodeId', 102);
        fixture.detectChanges();

        const item = openSeriesMenuItem();
        expect(item.textContent).toContain('Mark series as unwatched');
        item.click();

        expect(emitted).toEqual([
            {
                markWatched: false,
                requests: [
                    { contentXtreamId: 101, nextPosition: null },
                    { contentXtreamId: 102, nextPosition: null },
                    { contentXtreamId: 201, nextPosition: null },
                ],
            },
        ]);
    });

    it('shows the countless label and emits an empty mark request when unloaded seasons hide the total', () => {
        setRequiredInputs({ '1': [createEpisode({ id: '101' })] });
        fixture.componentRef.setInput('hasUnloadedSeasons', true);
        fixture.componentRef.setInput(
            'playbackPositions',
            new Map([[101, watchedPosition(101)]])
        );
        fixture.detectChanges();

        const item = openSeriesMenuItem();
        expect(item.textContent).toContain('Mark series as watched');
        expect(item.textContent).not.toContain('(');
        item.click();

        // Every loaded episode is watched — the host hydrates and rebuilds.
        expect(emitted).toEqual([{ markWatched: true, requests: [] }]);
    });

    it('disables the action while a batch runs or nothing is actionable', () => {
        setRequiredInputs(twoSeasons());
        fixture.componentRef.setInput('seasonWatchBatchRunning', true);
        fixture.detectChanges();
        expect(openSeriesMenuItem().disabled).toBe(true);

        // Single unwatched episode which is currently playing: nothing to
        // mark, series not fully watched, nothing unloaded.
        fixture.componentRef.setInput('seasonWatchBatchRunning', false);
        setRequiredInputs({ '1': [createEpisode({ id: '101' })] });
        fixture.componentRef.setInput('playingEpisodeId', 101);
        fixture.detectChanges();
        expect(openSeriesMenuItem().disabled).toBe(true);
    });
});
