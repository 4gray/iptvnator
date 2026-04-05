import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { DashboardDataService } from 'workspace-dashboard-data-access';
import { RecentlyWatchedWidgetComponent } from './recently-watched-widget.component';

describe('RecentlyWatchedWidgetComponent', () => {
    let fixture: ComponentFixture<RecentlyWatchedWidgetComponent>;

    const dataServiceMock = {
        globalRecentLoading: signal(true),
        globalRecentItems: signal([]),
        reloadGlobalRecentItems: jest.fn().mockResolvedValue(undefined),
        isTypeInKind: jest.fn(() => true),
        getRecentItemProviderLabel: jest.fn(() => 'Xtream'),
        getRecentItemTypeLabel: jest.fn(() => 'Live TV'),
        getRecentItemLink: jest.fn(() => ['/workspace', 'global-recent']),
        getRecentItemNavigationState: jest.fn(() => undefined),
        removeGlobalRecentItem: jest.fn(),
    };

    beforeEach(async () => {
        dataServiceMock.globalRecentLoading.set(true);
        dataServiceMock.globalRecentItems.set([]);
        jest.clearAllMocks();

        await TestBed.configureTestingModule({
            imports: [RecentlyWatchedWidgetComponent, TranslateModule.forRoot()],
            providers: [
                provideRouter([]),
                {
                    provide: DashboardDataService,
                    useValue: dataServiceMock,
                },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(RecentlyWatchedWidgetComponent);
        fixture.componentRef.setInput('widget', {
            id: 'recently-watched',
            type: 'recently-watched',
            enabled: true,
            order: 0,
            size: 'medium',
        } as any);
    });

    it('shows a spinner while recent history is loading', () => {
        fixture.detectChanges();

        expect(dataServiceMock.reloadGlobalRecentItems).toHaveBeenCalled();
        expect(
            fixture.nativeElement.querySelector('mat-progress-spinner')
        ).not.toBeNull();
        expect(fixture.nativeElement.querySelector('.empty-state')).toBeNull();
    });
});
