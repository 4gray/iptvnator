import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { DashboardDataService } from 'workspace-dashboard-data-access';
import { RecentlyAddedWidgetComponent } from './recently-added-widget.component';

describe('RecentlyAddedWidgetComponent', () => {
    let fixture: ComponentFixture<RecentlyAddedWidgetComponent>;

    const dataServiceMock = {
        getGlobalRecentlyAddedItems: jest.fn(() => new Promise(() => {})),
        getRecentlyAddedItemProviderLabel: jest.fn(() => 'Xtream'),
        getRecentlyAddedItemTypeLabel: jest.fn(() => 'Movie'),
        getRecentlyAddedLink: jest.fn(() => ['/workspace', 'global-favorites']),
        getRecentlyAddedNavigationState: jest.fn(() => undefined),
        formatTimestamp: jest.fn(() => 'recently'),
    };

    beforeEach(async () => {
        jest.clearAllMocks();

        await TestBed.configureTestingModule({
            imports: [RecentlyAddedWidgetComponent, TranslateModule.forRoot()],
            providers: [
                provideRouter([]),
                {
                    provide: DashboardDataService,
                    useValue: dataServiceMock,
                },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(RecentlyAddedWidgetComponent);
        fixture.componentRef.setInput('widget', {
            id: 'recently-added',
            type: 'recently-added',
            enabled: true,
            order: 0,
            size: 'medium',
        } as any);
    });

    it('shows a spinner while recently added items are loading', () => {
        fixture.detectChanges();

        expect(
            fixture.nativeElement.querySelector('mat-progress-spinner')
        ).not.toBeNull();
    });
});
