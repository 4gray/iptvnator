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
    private readonly activeActions = signal<
        ReadonlyMap<number, ActiveFileAction>
    >(new Map());
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
                const routeHasActiveAction = this.hasActiveAction(
                    this.activeActions(),
                    route.generation
                );
                if (
                    detail &&
                    !routeHasActiveAction &&
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
                    routeHasActiveAction ||
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
            this.activeActions().has(item.id) ||
            route.downloadId === undefined
        ) {
            return;
        }
        const active = {
            actionGeneration: ++this.actionGeneration,
            routeGeneration: route.generation,
        };
        this.activeActions.update((actions) =>
            new Map(actions).set(item.id, active)
        );
        this.ownedRouteGeneration.set(route.generation);
        const result = await this.actions.run({
            type,
            item: item as DownloadItem,
        });
        const stillOwnsAction = this.activeActions().get(item.id) === active;
        if (stillOwnsAction) {
            this.activeActions.update((actions) => {
                const next = new Map(actions);
                next.delete(item.id);
                return next;
            });
            if (
                result !== 'file-missing' &&
                !this.hasActiveAction(this.activeActions(), route.generation) &&
                this.ownedRouteGeneration() === route.generation
            ) {
                this.ownedRouteGeneration.set(undefined);
            }
        }
        if (
            !stillOwnsAction ||
            currentRoute().generation !== route.generation ||
            result !== 'file-missing'
        ) {
            return;
        }
        await this.redirect(route);
    }

    private hasActiveAction(
        actions: ReadonlyMap<number, ActiveFileAction>,
        routeGeneration: number
    ): boolean {
        return Array.from(actions.values()).some(
            (action) => action.routeGeneration === routeGeneration
        );
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
