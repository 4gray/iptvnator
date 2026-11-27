import {
    ChangeDetectionStrategy,
    Component,
    ComponentRef,
    EnvironmentInjector,
    OnDestroy,
    Type,
    ViewContainerRef,
    effect,
    computed,
    inject,
    input,
    linkedSignal,
    output,
    signal,
    untracked,
    viewChild,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { selectAllPlaylistsMeta } from '@iptvnator/m3u-state';
import { StateViewComponent } from '@iptvnator/ui/state';
import { TranslatePipe } from '@ngx-translate/core';
import { APP_ICONS } from '@iptvnator/ui/components/app-icons';
import { PortalDetailShellComponent } from '@iptvnator/ui/components';
import {
    PlaylistContextFacade,
    sourceDisplayName,
} from '@iptvnator/playlist/shared/util';
import {
    registerWorkspaceBack,
    WorkspaceBackNavigationService,
} from '@iptvnator/portal/shared/data-access';
import {
    UnifiedCollectionDetailDirective,
    UnifiedCollectionPageComponent,
    WatchedHistoryComponent,
} from '@iptvnator/portal/shared/ui';
import {
    COLLECTION_VIEW_STATE_KEY,
    CollectionScope,
    getCollectionViewState,
    PortalProvider,
    queryParamSignal,
    SeriesResumeTarget,
    UnifiedCollectionItem,
} from '@iptvnator/portal/shared/util';
import { createWatchedHistory } from '@iptvnator/workspace/dashboard/data-access';
import { WORKSPACE_SHELL_ACTIONS } from '@iptvnator/workspace/shell/util';

type UnifiedPortalType = 'm3u' | 'xtream' | 'stalker';
type CollectionMode = 'favorites' | 'recent';
const EMPTY_ITEMS: readonly UnifiedCollectionItem[] = [];

interface ComponentOutputRef {
    subscribe(callback: () => void): { unsubscribe(): void };
}

interface CollectionDetailInstance {
    closeRequested?: ComponentOutputRef;
}

const EMPTY_STATE_BY_MODE: Record<
    CollectionMode,
    { icon: string; titleKey: string; descriptionKey: string }
> = {
    favorites: {
        icon: APP_ICONS.favoriteOutline,
        titleKey: 'WORKSPACE.GLOBAL_FAVORITES.NO_PLAYLISTS_TITLE',
        descriptionKey: 'WORKSPACE.GLOBAL_FAVORITES.NO_PLAYLISTS_BODY',
    },
    recent: {
        icon: 'history_toggle_off',
        titleKey: 'WORKSPACE.GLOBAL_RECENT.NO_PLAYLISTS_TITLE',
        descriptionKey: 'WORKSPACE.GLOBAL_RECENT.NO_PLAYLISTS_BODY',
    },
};

function providerToPortalType(provider: PortalProvider): UnifiedPortalType {
    if (provider === 'playlists') return 'm3u';
    if (provider === 'xtreams') return 'xtream';
    return 'stalker';
}

@Component({
    selector: 'app-global-collection-detail-host',
    imports: [PortalDetailShellComponent],
    template: `
        @if (isLoading()) {
            <app-portal-detail-shell
                [isLoading]="true"
                [backAvailable]="false"
            />
        }
    `,
    styles: ':host { display: contents; }',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GlobalCollectionDetailHostComponent implements OnDestroy {
    readonly item = input<UnifiedCollectionItem | null>(null);
    readonly seriesResume = input<SeriesResumeTarget | null>(null);
    readonly closeRequested = output<void>();
    readonly isLoading = signal(false);

    private readonly viewContainer = inject(ViewContainerRef);
    private readonly environmentInjector = inject(EnvironmentInjector);
    private closeSubscription: { unsubscribe(): void } | null = null;
    private renderRequestId = 0;
    private detailRef: ComponentRef<unknown> | null = null;
    private detailKey: string | null = null;

    constructor() {
        effect(() => {
            const item = this.item();
            const seriesResume = this.seriesResume();

            untracked(() => {
                void this.renderDetail(item, seriesResume);
            });
        });
    }

    ngOnDestroy(): void {
        this.renderRequestId++;
        this.clearDetail();
    }

    private async renderDetail(
        item: UnifiedCollectionItem | null,
        seriesResume: SeriesResumeTarget | null
    ): Promise<void> {
        const key = item
            ? JSON.stringify([
                  item.sourceType,
                  item.playlistId,
                  item.uid,
                  item.contentType,
                  item.xtreamIdentity?.tmdbId,
                  item.xtreamIdentity?.releaseYear,
              ])
            : null;
        if (key && key === this.detailKey && this.detailRef) {
            this.detailRef.setInput('item', item);
            this.detailRef.setInput('seriesResume', seriesResume);
            return;
        }
        const requestId = ++this.renderRequestId;
        this.clearDetail();
        this.isLoading.set(
            item?.sourceType === 'xtream' || item?.sourceType === 'stalker'
        );

        if (!item) {
            return;
        }

        const componentType = await this.loadDetailComponent(item.sourceType);
        if (requestId !== this.renderRequestId || !componentType) {
            return;
        }

        const componentRef = this.viewContainer.createComponent(componentType, {
            environmentInjector: this.environmentInjector,
        });
        this.detailRef = componentRef;
        this.detailKey = key;
        componentRef.setInput('item', item);
        // Both portal details accept the one-shot resume handoff (Xtream
        // series, Stalker embedded-VOD / lazy is_series shows).
        componentRef.setInput('seriesResume', seriesResume);
        this.subscribeToClose(componentRef.instance);
        this.isLoading.set(false);
    }

    private async loadDetailComponent(
        sourceType: UnifiedCollectionItem['sourceType']
    ): Promise<Type<unknown> | null> {
        if (sourceType === 'xtream') {
            const component = await import('@iptvnator/portal/xtream/feature');
            return component.XtreamCollectionDetailComponent;
        }

        if (sourceType === 'stalker') {
            const component = await import('@iptvnator/portal/stalker/feature');
            return component.StalkerCollectionDetailComponent;
        }

        return null;
    }

    private subscribeToClose(instance: unknown): void {
        const closeRequested = (instance as CollectionDetailInstance)
            .closeRequested;

        if (!closeRequested) {
            return;
        }

        this.closeSubscription = closeRequested.subscribe(() => {
            this.closeRequested.emit();
        });
    }

    private clearDetail(): void {
        this.closeSubscription?.unsubscribe();
        this.closeSubscription = null;
        this.detailRef = null;
        this.detailKey = null;
        this.viewContainer.clear();
    }
}

@Component({
    selector: 'app-global-collection-route',
    imports: [
        StateViewComponent,
        TranslatePipe,
        GlobalCollectionDetailHostComponent,
        UnifiedCollectionDetailDirective,
        UnifiedCollectionPageComponent,
        WatchedHistoryComponent,
    ],
    template: `
        @if (hasNoPlaylists()) {
            <app-state-view
                [icon]="emptyState().icon"
                [heading]="emptyState().titleKey | translate"
                [description]="emptyState().descriptionKey | translate"
                [actionLabel]="'WORKSPACE.SOURCES.ADD_SOURCE' | translate"
                actionIcon="add"
                [secondaryLabel]="'WORKSPACE.SHELL.GO_TO_DASHBOARD' | translate"
                (action)="addPlaylist()"
                (secondaryAction)="goToDashboard()"
            />
        } @else {
            <app-unified-collection-page
                #collection
                [mode]="mode()"
                [playlistId]="collectionPlaylistId()"
                [portalType]="collectionPortalType()"
                [defaultScope]="effectiveDefaultScope()"
                [headerContent]="isRecent() ? watchedPreview : null"
                [alternateContent]="watchedExpanded() ? watchedFull : null"
            >
                <ng-template
                    unifiedCollectionDetail
                    let-item
                    let-seriesResume="seriesResume"
                    let-close="close"
                >
                    @if (item.sourceType === 'xtream') {
                        <app-global-collection-detail-host
                            [item]="item"
                            [seriesResume]="seriesResume"
                        />
                    } @else if (item.sourceType === 'stalker') {
                        <app-global-collection-detail-host
                            [item]="item"
                            [seriesResume]="seriesResume"
                            (closeRequested)="close()"
                        />
                    }
                </ng-template>
            </app-unified-collection-page>

            <ng-template #watchedPreview>
                <app-watched-history
                    [items]="watched.items()"
                    [loading]="watched.loading()"
                    [hasMore]="watched.hasMore()"
                    [seeAllQueryParams]="watchedLinkParams()"
                    (seeAllActivated)="collection.rememberScroll()"
                    (itemSelected)="collection.onGridItemSelected($event)"
                />
            </ng-template>

            <ng-template #watchedFull>
                <app-watched-history
                    [expanded]="true"
                    [items]="watched.items()"
                    [searchTerm]="collection.workspaceSearchTerm()"
                    [loading]="collection.isLoading() || watched.loading()"
                    [hasMore]="watched.hasMore()"
                    [scopeLabel]="
                        collection.effectiveScope() === 'playlist'
                            ? (scopePlaylistName() ??
                              ('PORTALS.THIS_PLAYLIST' | translate))
                            : ('PORTALS.ALL_PLAYLISTS' | translate)
                    "
                    (itemSelected)="collection.onGridItemSelected($event)"
                    (loadMoreRequested)="loadMoreWatched()"
                />
            </ng-template>
        }
    `,
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GlobalCollectionRouteComponent {
    private readonly playlistContext = inject(PlaylistContextFacade);
    private readonly store = inject(Store);
    private readonly shellActions = inject(WORKSPACE_SHELL_ACTIONS);
    private readonly router = inject(Router);
    private readonly route = inject(ActivatedRoute);
    private readonly backNavigation = inject(WorkspaceBackNavigationService);
    private readonly collection = viewChild(UnifiedCollectionPageComponent);

    readonly mode = input<CollectionMode>('favorites');
    readonly defaultScope = input<CollectionScope | undefined>(undefined);
    readonly isRecent = computed(() => this.mode() === 'recent');
    private readonly view = queryParamSignal(this.route, 'view');
    private readonly scopeParam = queryParamSignal(this.route, 'scope');
    private readonly playlistParam = queryParamSignal(this.route, 'playlistId');
    readonly watchedExpanded = computed(
        () => this.isRecent() && this.view() === 'watched'
    );
    private readonly watchedPage = linkedSignal(() =>
        this.watchedExpanded()
            ? (getCollectionViewState(history.state)?.watchedPage ?? 1)
            : 1
    );

    private readonly playlists = this.store.selectSignal(
        selectAllPlaylistsMeta
    );
    readonly hasNoPlaylists = computed(() => this.playlists().length === 0);

    readonly emptyState = computed(() => EMPTY_STATE_BY_MODE[this.mode()]);

    private readonly scopedPlaylistId = computed(() =>
        this.isRecent() && this.scopeParam() === 'playlist'
            ? this.playlistParam() || undefined
            : undefined
    );
    private readonly scopedPlaylist = computed(() => {
        const id = this.scopedPlaylistId();
        return id
            ? this.playlists().find((playlist) => playlist._id === id)
            : this.playlistContext.activePlaylist();
    });
    readonly collectionPlaylistId = computed(
        () => this.scopedPlaylistId() ?? this.scopedPlaylist()?._id
    );
    readonly scopePlaylistName = computed(() => {
        const playlist = this.scopedPlaylist();
        return playlist && sourceDisplayName(playlist);
    });
    readonly collectionPortalType = computed<UnifiedPortalType | undefined>(
        () => {
            const playlist = this.scopedPlaylist();
            return playlist
                ? providerToPortalType(
                      this.playlistContext.getProviderForPlaylist(playlist)
                  )
                : undefined;
        }
    );
    readonly effectiveDefaultScope = computed<CollectionScope>(() =>
        !this.isRecent() && this.collectionPlaylistId()
            ? 'playlist'
            : (this.defaultScope() ?? 'all')
    );
    readonly watched = createWatchedHistory({
        active: this.isRecent,
        expanded: this.watchedExpanded,
        page: this.watchedPage,
        items: computed(() => this.collection()?.scopedItems() ?? EMPTY_ITEMS),
    });
    readonly watchedLinkParams = computed(() => {
        const collection = this.collection();
        const scope = collection?.effectiveScope() ?? 'all';
        return {
            view: 'watched',
            scope,
            playlistId: scope === 'playlist' ? collection?.playlistId() : null,
        };
    });

    constructor() {
        registerWorkspaceBack({
            available: () =>
                this.watchedExpanded() &&
                !this.collection()?.selectedDetailItem(),
            run: () => this.closeWatched(),
        });
        let detailWasVisible = false;
        effect(() => {
            const detailVisible = Boolean(
                this.collection()?.selectedDetailItem()
            );
            if (detailWasVisible && !detailVisible) {
                untracked(() => this.watched.refresh());
            }
            detailWasVisible = detailVisible;
        });
    }

    private closeWatched(): void {
        const historyUrl = this.router.createUrlTree([], {
            relativeTo: this.route,
            queryParams: { view: null },
            queryParamsHandling: 'merge',
        });
        this.backNavigation.back(() => this.router.serializeUrl(historyUrl));
    }

    loadMoreWatched(): void {
        const watchedPage = this.watchedPage() + 1;
        history.replaceState(
            {
                ...history.state,
                [COLLECTION_VIEW_STATE_KEY]: {
                    ...getCollectionViewState(history.state),
                    watchedPage,
                },
            },
            document.title
        );
        this.watchedPage.set(watchedPage);
    }

    addPlaylist(): void {
        this.shellActions.openAddPlaylistDialog();
    }

    goToDashboard(): void {
        void this.router.navigate(['/workspace', 'dashboard']);
    }
}
