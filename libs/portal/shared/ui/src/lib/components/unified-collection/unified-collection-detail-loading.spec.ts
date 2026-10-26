import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { provideRouter } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslateModule } from '@ngx-translate/core';
import { DialogService } from '@iptvnator/ui/components';
import { RuntimeCapabilitiesService } from '@iptvnator/services';
import {
    OPEN_COLLECTION_DETAIL_STATE_KEY,
    ScopeToggleService,
    UnifiedCollectionItem,
    WorkspaceViewCommandService,
} from '@iptvnator/portal/shared/util';
import {
    UnifiedFavoritesDataService,
    UnifiedRecentDataService,
} from '@iptvnator/portal/shared/data-access';
import { UnifiedCollectionPageComponent } from './unified-collection-page.component';
import { UnifiedCollectionDetailDirective } from './unified-collection-detail.directive';

@Component({
    imports: [UnifiedCollectionPageComponent, UnifiedCollectionDetailDirective],
    template: `
        <app-unified-collection-page mode="recent">
            <ng-template unifiedCollectionDetail let-item>
                <div class="detail-probe">{{ item.name }}</div>
            </ng-template>
        </app-unified-collection-page>
    `,
})
class DetailLoadingHostComponent {}

describe('collection detail handoff loading', () => {
    const recentData = { getRecentItems: jest.fn() };

    beforeEach(async () => {
        recentData.getRecentItems.mockReset();
        await TestBed.configureTestingModule({
            imports: [DetailLoadingHostComponent, TranslateModule.forRoot()],
            providers: [
                provideRouter([]),
                {
                    provide: Store,
                    useValue: { selectSignal: () => signal([]) },
                },
                { provide: MatSnackBar, useValue: { open: jest.fn() } },
                { provide: DialogService, useValue: {} },
                {
                    provide: RuntimeCapabilitiesService,
                    useValue: { supportsEpg: false },
                },
                {
                    provide: ScopeToggleService,
                    useValue: { getScope: () => signal('all') },
                },
                {
                    provide: WorkspaceViewCommandService,
                    useValue: { registerCommand: () => () => undefined },
                },
                {
                    provide: UnifiedFavoritesDataService,
                    useValue: { getFavorites: jest.fn().mockResolvedValue([]) },
                },
                { provide: UnifiedRecentDataService, useValue: recentData },
            ],
        }).compileComponents();
    });

    afterEach(() => window.history.replaceState({}, document.title));

    it.each([
        ['xtream', 'movie'],
        ['xtream', 'series'],
        ['stalker', 'movie'],
        ['stalker', 'series'],
    ] as const)(
        'shows the detail skeleton while a %s %s handoff waits for recent items',
        async (sourceType, contentType) => {
            const item: UnifiedCollectionItem = {
                uid: `${sourceType}::source::${contentType}:77`,
                name: 'Dashboard title',
                contentType,
                sourceType,
                playlistId: 'source',
                playlistName: 'Source',
                xtreamId: 77,
                stalkerId: '77',
            };
            window.history.replaceState(
                { [OPEN_COLLECTION_DETAIL_STATE_KEY]: { item } },
                document.title
            );
            let resolveRecent!: (items: UnifiedCollectionItem[]) => void;
            recentData.getRecentItems.mockReturnValueOnce(
                new Promise((resolve) => (resolveRecent = resolve))
            );
            const hostFixture = TestBed.createComponent(
                DetailLoadingHostComponent
            );
            hostFixture.detectChanges();

            try {
                expect(
                    hostFixture.nativeElement.querySelector(
                        '[data-test-id="hero-skeleton"]'
                    )
                ).not.toBeNull();
                expect(
                    hostFixture.nativeElement.querySelector(
                        '.skeleton-list, .skeleton-grid, .collection-header, .detail-probe'
                    )
                ).toBeNull();
                // Opening provider detail still waits for collection validation.
                const page = hostFixture.debugElement.children[0]
                    .componentInstance as UnifiedCollectionPageComponent;
                expect(page.selectedDetailItem()).toBeNull();

                resolveRecent([item]);
                await new Promise((resolve) => setTimeout(resolve, 0));
                await hostFixture.whenStable();
                hostFixture.detectChanges();
                expect(
                    hostFixture.nativeElement.querySelector('.detail-probe')
                        ?.textContent
                ).toContain(item.name);
                expect(
                    hostFixture.nativeElement.querySelector(
                        '[data-test-id="hero-skeleton"]'
                    )
                ).toBeNull();
            } finally {
                resolveRecent([item]);
                hostFixture.destroy();
            }
        }
    );
});
