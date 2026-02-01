import {
    Component,
    effect,
    inject,
    signal,
    viewChild,
    ElementRef,
    AfterViewInit,
    OnDestroy,
} from '@angular/core';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatPaginatorModule } from '@angular/material/paginator';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute, Router, RouterOutlet } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { NgxSkeletonLoaderModule } from 'ngx-skeleton-loader';
import { PlaylistsService } from 'services';
import { PlaylistSwitcherComponent, ResizableDirective } from 'components';
import { CategoryViewComponent } from '../xtream-tauri/category-view/category-view.component';
import { PlaylistErrorViewComponent } from '../xtream/playlist-error-view/playlist-error-view.component';
import { StalkerStore } from './stalker.store';

@Component({
    selector: 'app-stalker-main-container',
    templateUrl: './stalker-main-container.component.html',
    styleUrls: [
        './stalker-main-container.component.scss',
        '../xtream-tauri/xtream-main-container.component.scss',
        '../xtream-tauri/sidebar.scss',
    ],
    imports: [
        CategoryViewComponent,
        MatIcon,
        MatIconButton,
        MatListModule,
        MatPaginatorModule,
        MatProgressSpinnerModule,
        NgxSkeletonLoaderModule,
        PlaylistErrorViewComponent,
        PlaylistSwitcherComponent,
        ResizableDirective,
        RouterOutlet,
        TranslatePipe,
    ],
})
export class StalkerMainContainerComponent implements AfterViewInit, OnDestroy {
    readonly stalkerStore = inject(StalkerStore);
    private readonly translateService = inject(TranslateService);

    currentLayout:
        | 'category_content'
        | 'serial-details'
        | 'vod-details'
        | 'not-available' = 'category_content';

    /* searchPhrase = this.portalStore.searchPhrase(); */

    readonly pageIndex = this.stalkerStore.page;
    readonly isLoadingMore = signal(false);
    readonly favorites = new Map<number, boolean>();

    /* load more functionality */
    readonly hasMoreItems = this.stalkerStore.hasMoreChannels;
    readonly itvChannels = this.stalkerStore.itvChannels;

    /** Scrollable container for ITV channels */
    readonly itvScrollContainer = viewChild<ElementRef>('itvScrollContainer');
    private scrollListener: (() => void) | null = null;

    readonly selectedCategoryTitle = this.stalkerStore.getSelectedCategoryName;
    readonly currentPlaylist = this.stalkerStore.currentPlaylist;

    /** categories */
    readonly categories = this.stalkerStore.getCategoryResource;
    readonly isCategoryLoading = this.stalkerStore.isCategoryResourceLoading;
    readonly isCategoryFailed = this.stalkerStore.isCategoryResourceFailed;

    /** content items */
    readonly contentItems = this.stalkerStore.getPaginatedContent;
    readonly isContentLoading = this.stalkerStore.isPaginatedContentLoading;

    /* readonly contentResource = resource({
        request: () => ({
            contentType: this.stalkerStore.selectedContentType(),
            category: this.stalkerStore.selectedCategoryId(),
            action: StalkerPortalActions.GetOrderedList,
            search: this.searchPhrase,
            pageIndex: this.pageIndex(),
        }),
        loader: async ({ request }) => {
            if (
                !request.category ||
                request.category === null ||
                request.category === ''
            ) {
                return Promise.resolve(undefined);
            }

            const { portalUrl, macAddress } = this.currentPlaylist();
            const params = {
                action: StalkerContentTypes[request.contentType]
                    .getContentAction,
                type: request.contentType,
                category: request.category ?? '',
                genre: request.category ?? '',
                //sortby: 'added',
                ...(request.search !== '' ? { search: request.search } : {}),
                p: request.pageIndex,
            };

            const response = await this.dataService.sendIpcEvent(
                STALKER_REQUEST,
                {
                    url: portalUrl,
                    macAddress,
                    params,
                }
            );

            if (response) {
                const newItems = response.js.data.map((item) => ({
                    ...item,
                    cover: item.screenshot_uri,
                }));

                // Check if we're loading the first page or loading more
                if (request.pageIndex === 0) {
                    this.itvChannels.set(newItems);
                } else {
                    // Append new items to existing ones
                    this.itvChannels.update((items) => [
                        ...items,
                        ...newItems,
                    ]);
                }

                // Update hasMoreItems based on total count and current items
                const totalLoaded = this.itvChannels().length;
                this.hasMoreItems.set(totalLoaded < response.js.total_items);

                return newItems;
            } else {
                this.currentLayout = 'not-available';
                this.showErrorAsNotification({
                    message: 'Error',
                    status: 500,
                });
                throw new Error(
                    `Error: ${response.message} (Status: ${response.status})`
                );
            }
        },
    }); */

    constructor(
        private readonly activatedRoute: ActivatedRoute,
        private readonly playlistService: PlaylistsService,
        private readonly router: Router,
        private readonly snackBar: MatSnackBar
    ) {
        // reset category title after changing content type
        effect(() => {
            this.stalkerStore.selectedContentType();
        });

        // reset items when category changes
        effect(() => {
            this.stalkerStore.selectedCategoryId();
            this.stalkerStore.setItvChannels([]);
            this.stalkerStore.setPage(0);
            //this.hasMoreItems.set(false);
        });

        // reset loading state when content resource changes and check if we need more
        effect(() => {
            if (this.contentItems() !== undefined) {
                this.isLoadingMore.set(false);
                // Check if we need to load more to fill the viewport
                this.checkIfNeedsMoreContent();
            }
        });

        // Also check when ITV channels are loaded
        effect(() => {
            const channels = this.itvChannels();
            if (channels.length > 0) {
                this.isLoadingMore.set(false);
                // Small delay to allow DOM to update before checking
                setTimeout(() => this.checkIfNeedsMoreContent(), 100);
            }
        });

        this.playlistService
            .getPortalFavorites(this.stalkerStore.currentPlaylist()?._id)
            .subscribe((favorites) => {
                favorites.forEach((fav: any) => {
                    this.favorites.set(fav.id, true);
                });
            });

        // Setup scroll listener when container becomes available
        effect(() => {
            const scrollContainer = this.itvScrollContainer();
            if (scrollContainer) {
                this.setupScrollListener();
            }
        });
    }

    ngAfterViewInit() {
        this.setupScrollListener();
    }

    ngOnDestroy() {
        this.removeScrollListener();
    }

    private setupScrollListener() {
        this.removeScrollListener();

        const container = this.itvScrollContainer()?.nativeElement;
        if (!container) return;

        const onScroll = () => {
            if (this.isLoadingMore() || !this.hasMoreItems()) return;

            const { scrollTop, scrollHeight, clientHeight } = container;
            const scrollThreshold = 150; // pixels from bottom to trigger load

            if (scrollHeight - scrollTop - clientHeight <= scrollThreshold) {
                this.loadMore();
            }
        };

        container.addEventListener('scroll', onScroll, { passive: true });
        this.scrollListener = () => container.removeEventListener('scroll', onScroll);
    }

    /**
     * Check if the container needs more content to become scrollable.
     * If content doesn't fill the viewport and there are more items, load more.
     */
    private checkIfNeedsMoreContent() {
        const container = this.itvScrollContainer()?.nativeElement;
        if (!container) return;
        if (this.isLoadingMore() || !this.hasMoreItems()) return;

        const { scrollHeight, clientHeight } = container;
        // If content doesn't fill the container (no scrollbar), load more
        if (scrollHeight <= clientHeight) {
            this.loadMore();
        }
    }

    private removeScrollListener() {
        if (this.scrollListener) {
            this.scrollListener();
            this.scrollListener = null;
        }
    }

    handshake() {
        /* this.sendRequest({
            action: StalkerPortalActions.Handshake,
            type: ContentType.STB,
        }); */
    }

    categoryClicked(item: { category_name: string; category_id: string }) {
        this.stalkerStore.setSelectedCategory(Number(item.category_id));
        this.currentLayout = 'category_content';
        this.stalkerStore.setPage(0);
        this.stalkerStore.setSelectedItem(undefined);
        if (this.stalkerStore.selectedContentType() === 'itv') return;

        this.router.navigate(['.', item.category_id], {
            relativeTo: this.activatedRoute,
        });
    }

    createLinkToPlayItv(item: any) {
        this.stalkerStore.setSelectedItem(item);
        this.stalkerStore.createLinkToPlayVod(item.cmd, item.o_name || item.name, item.logo);
    }

    toggleFavorite(item: any) {
        if (this.favorites.has(item.id)) {
            this.stalkerStore.removeFromFavorites(item.id);
            this.favorites.delete(item.id);
            this.snackBar.open('Removed from favorites', null, {
                duration: 1000,
            });
        } else {
            this.stalkerStore.addToFavorites({
                ...item,
                category_id: 'itv',
                title: item.o_name || item.name,
                cover: item.logo,
                added_at: new Date().toISOString(),
            });
            this.favorites.set(item.id, true);
            this.snackBar.open('Added to favorites', null, {
                duration: 1000,
            });
        }
    }

    loadMore() {
        if (this.isLoadingMore() || !this.hasMoreItems()) {
            return;
        }

        this.isLoadingMore.set(true);
        const nextPage = this.pageIndex() + 1;
        this.stalkerStore.setPage(nextPage);
        /* this.pageIndex.set(nextPage); */
    }

    historyBack() {
        this.currentLayout = 'category_content';
    }

    backToCategories() {
        this.stalkerStore.setSelectedCategory(null);
    }

    goBackToList() {
        this.stalkerStore.clearSelectedItem();
    }

    getContentLabel(): string {
        const categoryName = this.stalkerStore.getSelectedCategoryName();

        // Show page number when viewing category content (not detail view)
        if (
            !this.stalkerStore.selectedItem() &&
            this.stalkerStore.getTotalPages() > 1
        ) {
            const currentPage = this.stalkerStore.page() + 1;
            const totalPages = this.stalkerStore.getTotalPages();
            const pageLabel = this.translateService.instant('PORTALS.PAGE');
            return `${categoryName} (${pageLabel} ${currentPage}/${totalPages})`;
        }

        return categoryName;
    }
}
