import { effect, inject, Injectable, Injector, signal } from '@angular/core';
import type { DownloadOfflineSeason } from './download-offline-detail.viewmodel';
import { offlineSeasonKey } from './download-offline-detail.presentation';
import type { OfflineDetailRouteContext } from './download-offline-file-coordinator.service';

interface SeasonSelection {
    readonly key: string;
    readonly routeGeneration: number;
}

@Injectable()
export class DownloadOfflineSeasonSelectionService {
    private readonly injector = inject(Injector);
    private readonly selection = signal<SeasonSelection | undefined>(undefined);

    connect(
        route: () => OfflineDetailRouteContext,
        seasons: () => readonly DownloadOfflineSeason[]
    ): void {
        effect(
            () => {
                const currentRoute = route();
                const available = seasons();
                const current = this.selection();
                const currentAvailable = available.some(
                    (season) => offlineSeasonKey(season) === current?.key
                );
                if (available.length === 0) {
                    if (current) this.selection.set(undefined);
                    return;
                }
                if (
                    current?.routeGeneration === currentRoute.generation &&
                    currentAvailable
                ) {
                    return;
                }
                this.selection.set({
                    key: offlineSeasonKey(available[0]),
                    routeGeneration: currentRoute.generation,
                });
            },
            { injector: this.injector }
        );
    }

    selected(
        route: OfflineDetailRouteContext,
        seasons: readonly DownloadOfflineSeason[]
    ): DownloadOfflineSeason | undefined {
        const current = this.selection();
        if (current?.routeGeneration !== route.generation) return seasons[0];
        return (
            seasons.find(
                (season) => offlineSeasonKey(season) === current.key
            ) ?? seasons[0]
        );
    }

    select(
        route: OfflineDetailRouteContext,
        season: DownloadOfflineSeason
    ): void {
        this.selection.set({
            key: offlineSeasonKey(season),
            routeGeneration: route.generation,
        });
    }

    tabId(season: DownloadOfflineSeason): string {
        return `offline-${offlineSeasonKey(season)}-tab`;
    }

    handleKeydown(
        event: KeyboardEvent,
        index: number,
        route: OfflineDetailRouteContext,
        seasons: readonly DownloadOfflineSeason[]
    ): void {
        if (seasons.length === 0) return;
        const last = seasons.length - 1;
        const target = this.keyboardTarget(event.key, index, last);
        if (target === undefined) return;
        event.preventDefault();
        this.select(route, seasons[target]);
        const tabs = (
            event.currentTarget as HTMLElement | null
        )?.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
        tabs?.[target]?.focus();
    }

    private keyboardTarget(
        key: string,
        index: number,
        last: number
    ): number | undefined {
        if (key === 'Home') return 0;
        if (key === 'End') return last;
        if (key === 'ArrowRight' || key === 'ArrowDown') {
            return index === last ? 0 : index + 1;
        }
        if (key === 'ArrowLeft' || key === 'ArrowUp') {
            return index === 0 ? last : index - 1;
        }
        return undefined;
    }
}
