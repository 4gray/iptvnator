import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { DashboardDataService } from 'workspace-dashboard-data-access';
import { SourceStatsWidgetComponent } from './source-stats-widget.component';

describe('SourceStatsWidgetComponent', () => {
    let fixture: ComponentFixture<SourceStatsWidgetComponent>;

    const dataServiceMock = {
        playlistsLoaded: signal(false),
        stats: signal({
            total: 0,
            xtream: 0,
            stalker: 0,
            m3u: 0,
        }),
    };

    beforeEach(async () => {
        dataServiceMock.playlistsLoaded.set(false);

        await TestBed.configureTestingModule({
            imports: [SourceStatsWidgetComponent, TranslateModule.forRoot()],
            providers: [
                {
                    provide: DashboardDataService,
                    useValue: dataServiceMock,
                },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(SourceStatsWidgetComponent);
    });

    it('shows a spinner while playlists are still hydrating', () => {
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector('mat-progress-spinner')
        ).not.toBeNull();
        expect(fixture.nativeElement.querySelector('.stats-grid')).toBeNull();
    });
});
