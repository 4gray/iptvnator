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

// The shuffle button: its own visibility, and lazy (Stalker) seasons.

function createEpisode(id: number, season = 1): XtreamSerieEpisode {
    return {
        id: String(id),
        episode_num: id,
        title: `Episode ${id}`,
        container_extension: 'mp4',
        info: {},
        custom_sid: '',
        added: '',
        season,
        direct_source: '',
    } as XtreamSerieEpisode;
}

describe('SeasonContainerComponent random episode', () => {
    let fixture: ComponentFixture<SeasonContainerComponent>;
    let component: SeasonContainerComponent;

    const setInputs = (
        seasons: Record<string, XtreamSerieEpisode[]>,
        unloadedSeasonKeys: string[] = []
    ) => {
        fixture.componentRef.setInput('seasons', seasons);
        fixture.componentRef.setInput('seriesId', 20);
        fixture.componentRef.setInput('playlistId', 'playlist-1');
        fixture.componentRef.setInput('unloadedSeasonKeys', unloadedSeasonKeys);
    };
    const shuffleButton = (): HTMLElement | null =>
        fixture.nativeElement.querySelector('.play-random-episode');

    beforeEach(async () => {
        localStorage.clear();
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

    afterEach(() => jest.restoreAllMocks());

    it('shows shuffle for playable episodes that have no artwork or plot', () => {
        setInputs({ '1': [createEpisode(1), createEpisode(2)] });
        fixture.detectChanges();

        expect(component.metaState()).toBe('bare');
        expect(shuffleButton()).not.toBeNull();
    });

    it('shows shuffle while an empty season is selected if another has episodes', () => {
        setInputs({ '1': [], '2': [createEpisode(1, 2)] });
        fixture.detectChanges();
        component.selectSeason('1');
        fixture.detectChanges();

        expect(component.showSeasonEmptyState()).toBe(true);
        expect(shuffleButton()).not.toBeNull();
    });

    it('hides shuffle when the series has nothing to play', () => {
        setInputs({ '1': [] });
        fixture.detectChanges();

        expect(shuffleButton()).toBeNull();
    });

    it('loads an unloaded season it picks, then plays one of its episodes', () => {
        const played: XtreamSerieEpisode[] = [];
        component.episodeClicked.subscribe((episode) => played.push(episode));
        setInputs({ '1': [createEpisode(1)], '2': [] }, ['2']);
        fixture.detectChanges();

        // Total weight 2 (1 loaded episode + season 2 at the loaded average).
        jest.spyOn(Math, 'random').mockReturnValue(0.9);
        component.playRandomEpisode();
        fixture.detectChanges();

        expect(component.selectedSeason()).toBe('2');
        expect(played).toEqual([]);

        const loaded = createEpisode(7, 2);
        setInputs({ '1': [createEpisode(1)], '2': [loaded] }, []);
        fixture.detectChanges();

        expect(played).toEqual([loaded]);
    });

    it('drops a pending shuffle when the viewer moves to another season', () => {
        const played: XtreamSerieEpisode[] = [];
        component.episodeClicked.subscribe((episode) => played.push(episode));
        setInputs({ '1': [createEpisode(1)], '2': [] }, ['2']);
        fixture.detectChanges();

        jest.spyOn(Math, 'random').mockReturnValue(0.9);
        component.playRandomEpisode();
        fixture.detectChanges();
        component.selectSeason('1');
        fixture.detectChanges();

        setInputs({ '1': [createEpisode(1)], '2': [createEpisode(7, 2)] }, []);
        fixture.detectChanges();

        expect(played).toEqual([]);
    });
});
