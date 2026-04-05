import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { DashboardDataService } from 'workspace-dashboard-data-access';
import { ContinueWatchingWidgetComponent } from './continue-watching-widget.component';

describe('ContinueWatchingWidgetComponent', () => {
    let fixture: ComponentFixture<ContinueWatchingWidgetComponent>;

    const dataServiceMock = {
        globalRecentLoading: signal(true),
        globalRecentItems: signal([]),
        quickRecent: signal([]),
        getRecentItemLink: jest.fn(() => ['/workspace', 'global-recent']),
        getRecentItemNavigationState: jest.fn(() => undefined),
        getPlaylistLink: jest.fn(() => ['/workspace', 'sources']),
        getPlaylistProvider: jest.fn(() => 'M3U'),
    };

    beforeEach(async () => {
        dataServiceMock.globalRecentLoading.set(true);
        dataServiceMock.globalRecentItems.set([]);
        dataServiceMock.quickRecent.set([]);

        await TestBed.configureTestingModule({
            imports: [ContinueWatchingWidgetComponent, TranslateModule.forRoot()],
            providers: [
                provideRouter([]),
                {
                    provide: DashboardDataService,
                    useValue: dataServiceMock,
                },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(ContinueWatchingWidgetComponent);
    });

    it('shows a spinner while recent history is still loading', () => {
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector('mat-progress-spinner')
        ).not.toBeNull();
        expect(fixture.nativeElement.querySelector('.focus-empty')).toBeNull();
    });
});
