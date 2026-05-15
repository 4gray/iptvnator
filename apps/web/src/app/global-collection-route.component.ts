import {
    ChangeDetectionStrategy,
    Component,
    EnvironmentInjector,
    OnDestroy,
    Type,
    ViewContainerRef,
    effect,
    computed,
    inject,
    input,
    output,
    untracked,
} from '@angular/core';
import { Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { selectAllPlaylistsMeta } from '@iptvnator/m3u-state';
import { EmptyStateComponent } from '@iptvnator/playlist/shared/ui';
import { PlaylistContextFacade } from '@iptvnator/playlist/shared/util';
import {
    UnifiedCollectionDetailDirective,
    UnifiedCollectionPageComponent,
} from '@iptvnator/portal/shared/ui';
import {
    CollectionScope,
    PortalProvider,
    UnifiedCollectionItem,
} from '@iptvnator/portal/shared/util';
import { WORKSPACE_SHELL_ACTIONS } from '@iptvnator/workspace/shell/util';

type UnifiedPortalType = 'm3u' | 'xtream' | 'stalker';
type CollectionMode = 'favorites' | 'recent';

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
        icon: 'favorite_border',
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
    template: '',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GlobalCollectionDetailHostComponent implements OnDestroy {
    readonly item = input<UnifiedCollectionItem | null>(null);
    readonly closeRequested = output<void>();

    private readonly viewContainer = inject(ViewContainerRef);
    private readonly environmentInjector = inject(EnvironmentInjector);
    private closeSubscription: { unsubscribe(): void } | null = null;
    private renderRequestId = 0;

    constructor() {
        effect(() => {
            const item = this.item();

            untracked(() => {
                void this.renderDetail(item);
            });
        });
    }

    ngOnDestroy(): void {
        this.renderRequestId++;
        this.clearDetail();
    }

    private async renderDetail(
        item: UnifiedCollectionItem | null
    ): Promise<void> {
        const requestId = ++this.renderRequestId;
        this.clearDetail();

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
        componentRef.setInput('item', item);
        this.subscribeToClose(componentRef.instance);
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
        this.viewContainer.clear();
    }
}

@Component({
    selector: 'app-global-collection-route',
    imports: [
        EmptyStateComponent,
        GlobalCollectionDetailHostComponent,
        UnifiedCollectionDetailDirective,
        UnifiedCollectionPageComponent,
    ],
    template: `
        @if (hasNoPlaylists()) {
            <app-empty-state
                type="no-data"
                [icon]="emptyState().icon"
                [titleKey]="emptyState().titleKey"
                [descriptionKey]="emptyState().descriptionKey"
                primaryActionLabelKey="HOME.PLAYLISTS.ADD_YOUR_FIRST"
                secondaryActionLabelKey="WORKSPACE.SHELL.GO_TO_DASHBOARD"
                (primaryActionClicked)="addPlaylist()"
                (secondaryActionClicked)="goToDashboard()"
            />
        } @else {
            <app-unified-collection-page
                [mode]="mode()"
                [playlistId]="activePlaylistId() ?? undefined"
                [portalType]="activePortalType() ?? undefined"
                [defaultScope]="effectiveDefaultScope()"
            >
                <ng-template unifiedCollectionDetail let-item let-close="close">
                    @if (item.sourceType === 'xtream') {
                        <app-global-collection-detail-host [item]="item" />
                    } @else if (item.sourceType === 'stalker') {
                        <app-global-collection-detail-host
                            [item]="item"
                            (closeRequested)="close()"
                        />
                    }
                </ng-template>
            </app-unified-collection-page>
        }
    `,
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GlobalCollectionRouteComponent {
    private readonly playlistContext = inject(PlaylistContextFacade);
    private readonly store = inject(Store);
    private readonly shellActions = inject(WORKSPACE_SHELL_ACTIONS);
    private readonly router = inject(Router);

    readonly mode = input<CollectionMode>('favorites');
    readonly defaultScope = input<CollectionScope | undefined>(undefined);

    private readonly playlists = this.store.selectSignal(
        selectAllPlaylistsMeta
    );
    readonly hasNoPlaylists = computed(() => this.playlists().length === 0);

    readonly emptyState = computed(() => EMPTY_STATE_BY_MODE[this.mode()]);

    readonly activePlaylistId = computed(
        () => this.playlistContext.activePlaylist()?._id ?? null
    );
    readonly activePortalType = computed<UnifiedPortalType | null>(() => {
        const provider = this.playlistContext.activeProvider();
        return provider ? providerToPortalType(provider) : null;
    });
    readonly effectiveDefaultScope = computed<CollectionScope | undefined>(
        () =>
            this.activePlaylistId()
                ? 'playlist'
                : (this.defaultScope() ?? 'all')
    );

    addPlaylist(): void {
        this.shellActions.openAddPlaylistDialog();
    }

    goToDashboard(): void {
        void this.router.navigate(['/workspace', 'dashboard']);
    }
}
