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

// Coverage for the default-season fallback (issue #1441): earliest season
// with unwatched episodes, or the latest season once everything loaded is
// watched. The higher-priority auto-select rules (playing episode's season,
// most recent in-progress season) live in season-container.component.spec.ts,
// which sits at the max-lines cap.

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

const watchedPosition = (contentXtreamId: number) => ({
    contentXtreamId,
    contentType: 'episode' as const,
    positionSeconds: 2700,
    durationSeconds: 2700,
    updatedAt: '2026-07-01T00:00:00.000Z',
});

describe('SeasonContainerComponent default-season fallback', () => {
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

    it('auto-selects the earliest season with unwatched episodes when nothing is in progress', () => {
        // Season 1 fully watched, seasons 2 and 3 untouched → land on 2.
        fixture.componentRef.setInput(
            'playbackPositions',
            new Map([[101, watchedPosition(101)]])
        );
        setRequiredInputs({
            '1': [createEpisode()],
            '2': [createEpisode({ id: '201', season: 2 })],
            '3': [createEpisode({ id: '301', season: 3 })],
        });
        fixture.detectChanges();

        expect(component.selectedSeason()).toBe('2');
    });

    it('auto-selects the latest season once every loaded episode is watched', () => {
        fixture.componentRef.setInput(
            'playbackPositions',
            new Map([
                [101, watchedPosition(101)],
                [201, watchedPosition(201)],
            ])
        );
        setRequiredInputs({
            '1': [createEpisode()],
            '2': [createEpisode({ id: '201', season: 2 })],
        });
        fixture.detectChanges();

        expect(component.selectedSeason()).toBe('2');
    });

    it('keeps the first season without positions', () => {
        setRequiredInputs({
            '1': [createEpisode()],
            '2': [createEpisode({ id: '201', season: 2 })],
        });
        fixture.detectChanges();

        expect(component.selectedSeason()).toBe('1');
    });

    it('keeps the first-season fallback while lazy seasons are still unloaded', () => {
        // Stalker lazy VOD: unhydrated seasons have unknown watched state,
        // so a watched season 1 must not push the selection past them.
        fixture.componentRef.setInput('hasUnloadedSeasons', true);
        fixture.componentRef.setInput(
            'playbackPositions',
            new Map([[101, watchedPosition(101)]])
        );
        setRequiredInputs({
            '1': [createEpisode()],
            '2': [],
        });
        fixture.detectChanges();

        expect(component.selectedSeason()).toBe('1');
    });

    it('still prefers an in-progress season over the unwatched fallback', () => {
        // Season 1 has an in-progress episode; season 2 is unwatched — the
        // resume rule outranks the fallback.
        fixture.componentRef.setInput(
            'playbackPositions',
            new Map([
                [
                    101,
                    {
                        ...watchedPosition(101),
                        positionSeconds: 500,
                    },
                ],
            ])
        );
        setRequiredInputs({
            '1': [createEpisode()],
            '2': [createEpisode({ id: '201', season: 2 })],
        });
        fixture.detectChanges();

        expect(component.selectedSeason()).toBe('1');
    });
});
