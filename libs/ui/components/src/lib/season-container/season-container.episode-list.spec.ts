import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import { SeasonDownloadCoordinator } from '@iptvnator/portal/shared/data-access';
import {
    PlaybackPositionData,
    XtreamSerieEpisode,
} from '@iptvnator/shared/interfaces';
import { DownloadsService } from '@iptvnator/services';
import { SeasonContainerComponent } from './season-container.component';

// The episode list of the selected season: the "now playing / continue"
// highlight, the header counter, the episode menu and the season
// description. The main season-container spec sits at the max-lines cap.

function createEpisode(
    overrides: Partial<XtreamSerieEpisode> = {}
): XtreamSerieEpisode {
    return {
        id: '101',
        episode_num: 1,
        title: 'Pilot',
        container_extension: 'mp4',
        info: { duration: '45 min', plot: 'Pilot episode' },
        custom_sid: '',
        added: '',
        season: 1,
        direct_source: '',
        ...overrides,
    } as XtreamSerieEpisode;
}

describe('SeasonContainerComponent episode list', () => {
    let fixture: ComponentFixture<SeasonContainerComponent>;
    let component: SeasonContainerComponent;

    const setRequiredInputs = (
        seasons: Record<string, XtreamSerieEpisode[]>
    ) => {
        fixture.componentRef.setInput('seasons', seasons);
        fixture.componentRef.setInput('seriesId', 20);
        fixture.componentRef.setInput('playlistId', 'playlist-1');
    };

    beforeEach(async () => {
        localStorage.removeItem('iptvnator_episode_view_mode');
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

    afterEach(() => {
        localStorage.removeItem('iptvnator_episode_view_mode');
    });

    it('defaults to the list view', () => {
        setRequiredInputs({ '1': [createEpisode()] });
        fixture.detectChanges();

        expect(component.viewMode()).toBe('list');
        expect(
            fixture.nativeElement.querySelector(
                '.episodes-list .episode-list-item'
            )
        ).not.toBeNull();
    });

    it('counts the episodes and the watched ones in the header', () => {
        fixture.componentRef.setInput(
            'playbackPositions',
            new Map([
                [
                    102,
                    {
                        contentXtreamId: 102,
                        contentType: 'episode',
                        positionSeconds: 2700,
                        durationSeconds: 2700,
                    } as PlaybackPositionData,
                ],
            ])
        );
        setRequiredInputs({
            '1': [
                createEpisode(),
                createEpisode({ id: '102', episode_num: 2 }),
            ],
        });
        fixture.detectChanges();

        expect(
            fixture.nativeElement
                .querySelector('.section-header__count')
                ?.textContent.trim()
        ).toBe('PORTALS.EPISODE_COUNT_OTHER · PORTALS.EPISODES_WATCHED_COUNT');
    });

    it('highlights the most recently watched unfinished episode when nothing plays', () => {
        const position = (
            contentXtreamId: number,
            positionSeconds: number,
            updatedAt: string
        ): PlaybackPositionData => ({
            contentXtreamId,
            contentType: 'episode',
            positionSeconds,
            durationSeconds: 2700,
            updatedAt,
        });
        fixture.componentRef.setInput(
            'playbackPositions',
            new Map([
                [101, position(101, 600, '2026-10-01T10:00:00Z')],
                [102, position(102, 900, '2026-10-02T10:00:00Z')],
                [103, position(103, 2690, '2026-10-03T10:00:00Z')],
            ])
        );
        setRequiredInputs({
            '1': [
                createEpisode(),
                createEpisode({ id: '102', episode_num: 2 }),
                createEpisode({ id: '103', episode_num: 3 }),
            ],
        });
        fixture.detectChanges();

        expect(component.currentEpisodeId()).toBe(102);
        const current = fixture.nativeElement.querySelectorAll(
            '.episode-item--current'
        );
        expect(current.length).toBe(1);
        expect(current[0].getAttribute('data-episode-id')).toBe('102');
    });

    it('plays from the beginning through the episode menu', () => {
        fixture.componentRef.setInput(
            'playbackPositions',
            new Map([
                [
                    101,
                    {
                        contentXtreamId: 101,
                        contentType: 'episode',
                        positionSeconds: 600,
                        durationSeconds: 2700,
                    } as PlaybackPositionData,
                ],
            ])
        );
        const restarted: XtreamSerieEpisode[] = [];
        component.episodeRestartRequested.subscribe((episode) =>
            restarted.push(episode)
        );
        setRequiredInputs({ '1': [createEpisode()] });
        fixture.detectChanges();

        (
            fixture.nativeElement.querySelector(
                '[data-testid="episode-more-button"]'
            ) as HTMLButtonElement
        ).click();
        fixture.detectChanges();
        (
            document.querySelector(
                '[data-testid="episode-play-from-beginning"]'
            ) as HTMLButtonElement
        ).click();

        expect(restarted.map((episode) => episode.id)).toEqual(['101']);
    });
});
