import { computed, Component, inject, signal } from '@angular/core';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatChipsModule } from '@angular/material/chips';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatIcon } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { Store } from '@ngrx/store';
import { selectAllPlaylistsMeta } from 'm3u-state';
import { DashboardLayoutService } from 'workspace-dashboard-data-access';
import { DashboardWidgetHostComponent } from 'workspace-dashboard-ui';
import {
    DashboardWidgetConfig,
    DashboardWidgetProvider,
    DashboardWidgetSize,
    createDefaultWidgetScope,
} from 'workspace-dashboard-data-access';

@Component({
    selector: 'app-workspace-dashboard',
    imports: [
        DashboardWidgetHostComponent,
        DragDropModule,
        MatButtonModule,
        MatButtonToggleModule,
        MatCheckboxModule,
        MatChipsModule,
        MatExpansionModule,
        MatIcon,
        MatSlideToggleModule,
    ],
    templateUrl: './workspace-dashboard.component.html',
    styleUrl: './workspace-dashboard.component.scss',
})
export class WorkspaceDashboardComponent {
    private readonly store = inject(Store);

    readonly editMode = signal(false);
    readonly playlists = this.store.selectSignal(selectAllPlaylistsMeta);
    readonly providerOptions: DashboardWidgetProvider[] = [
        'm3u',
        'xtream',
        'stalker',
    ];
    readonly sizeOptions: Array<{ value: DashboardWidgetSize; label: string }> = [
        { value: 'one-third', label: '1/3' },
        { value: 'half', label: '1/2' },
        { value: 'two-thirds', label: '2/3' },
        { value: 'full', label: 'Full' },
    ];

    readonly allWidgets = computed(() =>
        [...this.layoutService.state().widgets].sort((a, b) => a.order - b.order)
    );
    readonly visibleWidgets = computed(() =>
        this.allWidgets().filter((widget) => widget.enabled)
    );

    constructor(readonly layoutService: DashboardLayoutService) {}

    toggleEditMode(): void {
        this.editMode.update((value) => !value);
    }

    onWidgetDrop(event: CdkDragDrop<DashboardWidgetConfig[]>): void {
        if (event.previousIndex === event.currentIndex) {
            return;
        }
        const reordered = [...this.visibleWidgets()];
        moveItemInArray(reordered, event.previousIndex, event.currentIndex);
        this.layoutService.reorderVisibleWidgets(reordered.map((widget) => widget.id));
    }

    setWidgetSize(widgetId: string, size: unknown): void {
        if (
            size === 'one-third' ||
            size === 'half' ||
            size === 'two-thirds' ||
            size === 'full'
        ) {
            this.layoutService.setWidgetSize(widgetId, size);
        }
    }

    hideWidget(widgetId: string): void {
        this.layoutService.toggleWidget(widgetId);
    }

    supportsScope(widget: DashboardWidgetConfig): boolean {
        return Boolean(widget.settings?.scope);
    }

    getProviderLabel(provider: DashboardWidgetProvider): string {
        if (provider === 'xtream') {
            return 'Xtream';
        }
        if (provider === 'stalker') {
            return 'Stalker';
        }
        return 'M3U';
    }

    getScopeProviderCount(widget: DashboardWidgetConfig): number {
        return (widget.settings?.scope ?? createDefaultWidgetScope()).providers.length;
    }

    getScopeProviderSummary(widget: DashboardWidgetConfig): string {
        const count = this.getScopeProviderCount(widget);
        return count === 0 ? 'All providers' : `${count} selected`;
    }

    isAllProvidersScope(widget: DashboardWidgetConfig): boolean {
        return this.getScopeProviderCount(widget) === 0;
    }

    isProviderSelected(
        widget: DashboardWidgetConfig,
        provider: DashboardWidgetProvider
    ): boolean {
        return (
            (widget.settings?.scope ?? createDefaultWidgetScope()).providers.includes(
                provider
            )
        );
    }

    getScopePlaylists(widget: DashboardWidgetConfig) {
        const scope = widget.settings?.scope ?? createDefaultWidgetScope();
        const scopedProviders =
            scope.providers.length === 0 ? this.providerOptions : scope.providers;
        return this.playlists().filter((playlist) =>
            scopedProviders.includes(this.getPlaylistProviderType(playlist))
        );
    }

    isPlaylistSelected(widget: DashboardWidgetConfig, playlistId: string): boolean {
        return (
            (widget.settings?.scope ?? createDefaultWidgetScope()).playlistIds.includes(
                playlistId
            )
        );
    }

    toggleScopeProvider(
        widgetId: string,
        provider: DashboardWidgetProvider
    ): void {
        this.layoutService.toggleWidgetScopeProvider(widgetId, provider);
    }

    toggleScopePlaylist(widgetId: string, playlistId: string): void {
        this.layoutService.toggleWidgetScopePlaylist(widgetId, playlistId);
    }

    getPlaylistTitle(playlist: {
        title?: string;
        filename?: string;
        url?: string;
        _id?: string;
    }): string {
        return (
            playlist.title ||
            playlist.filename ||
            playlist.url ||
            playlist._id ||
            'Untitled playlist'
        );
    }

    private getPlaylistProviderType(playlist: {
        serverUrl?: string;
        macAddress?: string;
    }): DashboardWidgetProvider {
        if (playlist.serverUrl) {
            return 'xtream';
        }
        if (playlist.macAddress) {
            return 'stalker';
        }
        return 'm3u';
    }
}
