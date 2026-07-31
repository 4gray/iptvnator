import { effect, inject, Injectable, Injector, signal } from '@angular/core';
import type { DownloadItem } from '@iptvnator/services';
import type { DownloadOfflineDetail } from './download-offline-detail.viewmodel';
import type { OfflineDetailItem } from './download-offline-detail.presentation';
import { DownloadManagerActionsService } from '../download-manager-actions.service';
import { DownloadOfflineRouteNavigationService } from './download-offline-route-navigation.service';

export interface OfflineDetailRouteContext {
    readonly downloadId?: number;
    readonly generation: number;
}

interface ActiveFileAction {
    readonly actionGeneration: number;
    readonly routeGeneration: number;
}

interface RedirectState {
    readonly routeGeneration: number;
    readonly status: 'pending' | 'failed' | 'succeeded';
}

interface RedirectInputs {
    readonly detail: () => DownloadOfflineDetail | undefined;
    readonly hasLoaded: () => boolean;
    readonly isLoading: () => boolean;
    readonly route: () => OfflineDetailRouteContext;
    readonly selectedRow: () => DownloadItem | undefined;
}

@Injectable()
export class DownloadOfflineFileCoordinatorService {
    private readonly actions = inject(DownloadManagerActionsService);
    private readonly navigation = inject(DownloadOfflineRouteNavigationService);
    private readonly injector = inject(Injector);
    private readonly activeAction = signal<ActiveFileAction | undefined>(
        undefined
    );
    private readonly ownedRouteGeneration = signal<number | undefined>(
        undefined
    );
    private readonly redirectState = signal<RedirectState | undefined>(
        undefined
    );
    private actionGeneration = 0;

    connect(inputs: RedirectInputs): void {
        effect(
            () => {
                const route = inputs.route();
                const row = inputs.selectedRow();
                const detail = inputs.detail();
                const activeRouteGeneration =
                    this.activeAction()?.routeGeneration;
                if (
                    detail &&
                    activeRouteGeneration !== route.generation &&
                    this.ownedRouteGeneration() === route.generation
                ) {
                    this.ownedRouteGeneration.set(undefined);
                }
                const unavailable =
                    route.downloadId !== undefined &&
                    inputs.hasLoaded() &&
                    !inputs.isLoading() &&
                    row?.status === 'completed' &&
                    !detail;
                if (
                    !unavailable ||
                    activeRouteGeneration === route.generation ||
                    this.ownedRouteGeneration() === route.generation ||
                    this.redirectState()?.routeGeneration === route.generation
                ) {
                    return;
                }
                void this.redirect(route);
            },
            { injector: this.injector }
        );
    }

    isRedirectFailed(route: OfflineDetailRouteContext): boolean {
        const state = this.redirectState();
        return (
            state?.routeGeneration === route.generation &&
            state.status === 'failed'
        );
    }

    async retry(route: OfflineDetailRouteContext): Promise<void> {
        if (!this.isRedirectFailed(route)) return;
        await this.redirect(route);
    }

    async runFileAction(
        type: 'play' | 'reveal',
        item: OfflineDetailItem,
        currentRoute: () => OfflineDetailRouteContext
    ): Promise<void> {
        const route = currentRoute();
        if (
            this.activeAction()?.routeGeneration === route.generation ||
            route.downloadId === undefined
        ) {
            return;
        }
        const active = {
            actionGeneration: ++this.actionGeneration,
            routeGeneration: route.generation,
        };
        this.activeAction.set(active);
        this.ownedRouteGeneration.set(route.generation);
        const result = await this.actions.run({
            type,
            item: item as DownloadItem,
        });
        const stillOwnsAction = this.activeAction() === active;
        if (stillOwnsAction) this.activeAction.set(undefined);
        if (
            !stillOwnsAction ||
            currentRoute().generation !== route.generation ||
            result !== 'file-missing'
        ) {
            return;
        }
        await this.redirect(route);
    }

    private async redirect(route: OfflineDetailRouteContext): Promise<void> {
        const state = this.redirectState();
        if (
            state?.routeGeneration === route.generation &&
            state.status !== 'failed'
        ) {
            return;
        }
        const pending: RedirectState = {
            routeGeneration: route.generation,
            status: 'pending',
        };
        this.redirectState.set(pending);
        const succeeded = await this.navigation.toManager(true);
        if (this.redirectState() !== pending) return;
        this.redirectState.set({
            routeGeneration: route.generation,
            status: succeeded ? 'succeeded' : 'failed',
        });
    }
}
