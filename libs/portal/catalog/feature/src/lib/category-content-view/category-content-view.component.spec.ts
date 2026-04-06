import { Component, input, output, signal } from '@angular/core';
import { NgComponentOutlet } from '@angular/common';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatPaginatorModule } from '@angular/material/paginator';
import { MatTooltip } from '@angular/material/tooltip';
import {
    ActivatedRoute,
    convertToParamMap,
    Router,
} from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ReplaySubject, of } from 'rxjs';
import {
    PORTAL_CATALOG_DETAIL_COMPONENT,
    PORTAL_CATALOG_FACADE,
    PortalCatalogSortMode,
} from '@iptvnator/portal/shared/util';
import { CategoryContentViewComponent } from './category-content-view.component';

@Component({
    selector: 'app-grid-list',
    standalone: true,
    template: '',
})
class MockGridListComponent {
    readonly isLoading = input<boolean>();
    readonly items = input<unknown[]>();
    readonly pageIndex = input<number>();
    readonly totalPages = input<number>();
    readonly limit = input<number>();
    readonly pageSizeOptions = input<number[]>();
    readonly showPaginator = input(true);
    readonly itemClicked = output<unknown>();
    readonly pageChange = output<unknown>();
}

@Component({
    selector: 'app-playlist-error-view',
    standalone: true,
    template: '',
})
class MockPlaylistErrorViewComponent {
    readonly title = input('');
    readonly description = input('');
    readonly showActionButtons = input(true);
    readonly viewType = input('');
}

@Component({
    standalone: true,
    template: '',
})
class MockDetailComponent {}

describe('CategoryContentViewComponent', () => {
    let fixture: ComponentFixture<CategoryContentViewComponent>;
    const paramMap$ = new ReplaySubject(1);
    const queryParamMap$ = new ReplaySubject(1);
    const isPaginatedContentLoading = signal(true);
    const categoryItemCount = signal(0);
    const contentSortMode = signal<PortalCatalogSortMode | null>(null);
    const catalog = {
        provider: 'xtream' as const,
        pageSizeOptions: [10, 25, 50],
        contentType: signal('vod'),
        limit: signal(25),
        pageIndex: signal(0),
        selectedCategory: signal({ id: 1 }),
        paginatedContent: signal<unknown[]>([]),
        selectedCategoryTitle: signal('Movies'),
        categoryItemCount,
        selectedItem: signal(null),
        totalPages: signal(0),
        contentSortMode,
        playlist: signal(null),
        isPaginatedContentLoading,
        initialize: jest.fn(),
        setSearchQuery: jest.fn(),
        clearSelectedItem: jest.fn(),
        setPage: jest.fn(),
        setLimit: jest.fn(),
        setContentSortMode: jest.fn(),
        selectItem: jest.fn().mockReturnValue(null),
        getItemProgress: jest.fn().mockReturnValue({}),
    };

    beforeEach(async () => {
        isPaginatedContentLoading.set(true);
        categoryItemCount.set(0);
        contentSortMode.set(null);
        catalog.initialize.mockClear();
        catalog.setSearchQuery.mockClear();
        paramMap$.next(convertToParamMap({}));
        queryParamMap$.next(convertToParamMap({}));

        await TestBed.configureTestingModule({
            imports: [CategoryContentViewComponent, NoopAnimationsModule],
            providers: [
                {
                    provide: TranslateService,
                    useValue: {
                        instant: (key: string) =>
                            key === 'WORKSPACE.SHELL.XTREAM_IMPORT_LOADING'
                                ? 'Fetching playlist data from source...'
                                : key,
                        get: (key: string) =>
                            of(
                                key === 'WORKSPACE.SHELL.XTREAM_IMPORT_LOADING'
                                    ? 'Fetching playlist data from source...'
                                    : key
                            ),
                        stream: (key: string) =>
                            of(
                                key === 'WORKSPACE.SHELL.XTREAM_IMPORT_LOADING'
                                    ? 'Fetching playlist data from source...'
                                    : key
                            ),
                        onLangChange: of(null),
                        onTranslationChange: of(null),
                        onDefaultLangChange: of(null),
                        currentLang: 'en',
                        defaultLang: 'en',
                    },
                },
                {
                    provide: PORTAL_CATALOG_FACADE,
                    useValue: catalog,
                },
                {
                    provide: PORTAL_CATALOG_DETAIL_COMPONENT,
                    useValue: MockDetailComponent,
                },
                {
                    provide: ActivatedRoute,
                    useValue: {
                        paramMap: paramMap$.asObservable(),
                        queryParamMap: queryParamMap$.asObservable(),
                        snapshot: {
                            params: {},
                        },
                    },
                },
                {
                    provide: Router,
                    useValue: {
                        navigate: jest.fn(),
                    },
                },
            ],
        })
            .overrideComponent(CategoryContentViewComponent, {
                set: {
                    imports: [
                        NgComponentOutlet,
                        MockGridListComponent,
                        MockPlaylistErrorViewComponent,
                        MatIcon,
                        MatIconButton,
                        MatMenuModule,
                        MatPaginatorModule,
                        MatTooltip,
                        TranslatePipe,
                    ],
                },
            })
            .compileComponents();

        fixture = TestBed.createComponent(CategoryContentViewComponent);
    });

    it('shows loading copy in the subtitle instead of 0 items while xtream content is still warming up', () => {
        fixture.detectChanges();

        const subtitle = fixture.nativeElement.querySelector(
            '.category-subtitle'
        ) as HTMLElement | null;

        expect(catalog.initialize).toHaveBeenCalledWith(null);
        expect(subtitle?.textContent?.trim()).toBe(
            'Fetching playlist data from source...'
        );
    });

    it('forwards query-param search updates to the catalog facade when supported', () => {
        fixture.detectChanges();
        catalog.setSearchQuery.mockClear();

        queryParamMap$.next(
            convertToParamMap({
                q: 'matrix',
            })
        );

        expect(catalog.setSearchQuery).toHaveBeenCalledWith('matrix');
    });
});
