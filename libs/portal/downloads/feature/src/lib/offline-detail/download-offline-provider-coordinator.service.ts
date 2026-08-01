import { effect, inject, Injectable, Injector, signal } from '@angular/core';
import type { DownloadItem } from '@iptvnator/services';
import type { WorkspaceNavigationTarget } from '@iptvnator/portal/shared/util';
import { DownloadLibraryNavigationService } from '../download-library-navigation.service';
import type { OfflineDetailRouteContext } from './download-offline-file-coordinator.service';
import type { OfflineDetailItem } from './download-offline-detail.presentation';

type ProviderTargetStatus = 'loading' | 'available' | 'unavailable' | 'opening';

interface ProviderTargetState {
    readonly itemId?: number;
    readonly routeGeneration?: number;
    readonly status: ProviderTargetStatus;
    readonly target?: WorkspaceNavigationTarget;
}

export type ProviderOpenResult = 'success' | 'failed' | 'ignored';

function targetKey(
    route: OfflineDetailRouteContext,
    item: OfflineDetailItem | undefined
): string | undefined {
    if (!item || route.downloadId === undefined) return undefined;
    return JSON.stringify([
        route.generation,
        route.downloadId,
        item.id,
        item.playlistId,
        item.contentType,
        item.xtreamId,
        item.seriesXtreamId,
        item.title,
        item.posterUrl,
        item.metadataSnapshot?.providerCategoryId,
    ]);
}

@Injectable()
export class DownloadOfflineProviderCoordinatorService {
    private readonly navigation = inject(DownloadLibraryNavigationService);
    private readonly injector = inject(Injector);
    private readonly targetState = signal<ProviderTargetState>({
        status: 'loading',
    });
    private generation = 0;
    private currentKey?: string;

    readonly state = this.targetState.asReadonly();

    connect(
        route: () => OfflineDetailRouteContext,
        item: () => OfflineDetailItem | undefined
    ): void {
        effect(
            () => {
                const currentRoute = route();
                const currentItem = item();
                const key = targetKey(currentRoute, currentItem);
                if (key === this.currentKey) return;
                this.currentKey = key;
                const generation = ++this.generation;
                if (!currentItem || !key) {
                    this.targetState.set({ status: 'loading' });
                    return;
                }
                const base = {
                    itemId: currentItem.id,
                    routeGeneration: currentRoute.generation,
                };
                this.targetState.set({ ...base, status: 'loading' });
                void this.navigation
                    .resolveProviderTarget(currentItem as DownloadItem)
                    .then((target) => {
                        if (
                            generation !== this.generation ||
                            key !== this.currentKey
                        ) {
                            return;
                        }
                        this.targetState.set(
                            target
                                ? { ...base, status: 'available', target }
                                : { ...base, status: 'unavailable' }
                        );
                    })
                    .catch(() => {
                        if (
                            generation === this.generation &&
                            key === this.currentKey
                        ) {
                            this.targetState.set({
                                ...base,
                                status: 'unavailable',
                            });
                        }
                    });
            },
            { injector: this.injector }
        );
    }

    async open(
        route: OfflineDetailRouteContext,
        item: OfflineDetailItem | undefined
    ): Promise<ProviderOpenResult> {
        const state = this.targetState();
        const key = targetKey(route, item);
        if (
            !key ||
            key !== this.currentKey ||
            state.status !== 'available' ||
            !state.target
        ) {
            return 'ignored';
        }
        const opening = { ...state, status: 'opening' as const };
        this.targetState.set(opening);
        let succeeded = false;
        try {
            succeeded = await this.navigation.navigateResolvedTarget(
                state.target
            );
        } catch {
            succeeded = false;
        }
        if (this.targetState() !== opening || key !== this.currentKey) {
            return 'ignored';
        }
        this.targetState.set(state);
        return succeeded ? 'success' : 'failed';
    }
}
