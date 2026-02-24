import { effect, Injectable, signal } from '@angular/core';
import {
    ALL_DASHBOARD_WIDGET_PROVIDERS,
    DASHBOARD_LAYOUT_VERSION,
    DashboardLayoutState,
    DashboardWidgetConfig,
    DashboardWidgetProvider,
    DashboardWidgetScopeSettings,
    DashboardWidgetSize,
    DASHBOARD_WIDGET_SIZE_OPTIONS,
    DEFAULT_DASHBOARD_WIDGETS,
    createDefaultWidgetScope,
} from './dashboard-widget.model';

const DASHBOARD_LAYOUT_STORAGE_KEY = 'workspace-dashboard-layout-v3';

@Injectable({ providedIn: 'root' })
export class DashboardLayoutService {
    readonly state = signal<DashboardLayoutState>(this.loadState());

    constructor() {
        effect(() => {
            this.persistState(this.state());
        });
    }

    toggleWidget(widgetId: string): void {
        this.updateWidget(widgetId, (widget) => ({
            ...widget,
            enabled: !widget.enabled,
        }));
    }

    getWidget(widgetId: string): DashboardWidgetConfig | undefined {
        return this.state().widgets.find((widget) => widget.id === widgetId);
    }

    setWidgetScope(widgetId: string, scope: DashboardWidgetScopeSettings): void {
        this.updateWidget(widgetId, (widget) => ({
            ...widget,
            settings: {
                ...widget.settings,
                scope: this.normalizeScope(scope),
            },
        }));
    }

    toggleWidgetScopeProvider(
        widgetId: string,
        provider: DashboardWidgetProvider
    ): void {
        const widget = this.getWidget(widgetId);
        const currentScope = this.normalizeScope(widget?.settings?.scope);
        const hasProvider = currentScope.providers.includes(provider);
        const providers = hasProvider
            ? currentScope.providers.filter((item) => item !== provider)
            : [...currentScope.providers, provider];

        this.setWidgetScope(widgetId, {
            ...currentScope,
            providers,
        });
    }

    toggleWidgetScopePlaylist(widgetId: string, playlistId: string): void {
        const widget = this.getWidget(widgetId);
        const currentScope = this.normalizeScope(widget?.settings?.scope);
        const hasPlaylist = currentScope.playlistIds.includes(playlistId);
        const playlistIds = hasPlaylist
            ? currentScope.playlistIds.filter((id) => id !== playlistId)
            : [...currentScope.playlistIds, playlistId];

        this.setWidgetScope(widgetId, {
            ...currentScope,
            playlistIds,
        });
    }

    setWidgetSize(widgetId: string, size: DashboardWidgetSize): void {
        this.updateWidget(widgetId, (widget) => ({
            ...widget,
            size: this.normalizeSize(size),
        }));
    }

    reorderVisibleWidgets(orderedVisibleWidgetIds: string[]): void {
        const orderedIds = orderedVisibleWidgetIds.filter(Boolean);
        if (orderedIds.length === 0) {
            return;
        }

        const widgetsById = new Map(
            this.state().widgets.map((widget) => [widget.id, widget])
        );
        const visibleWidgets = orderedIds
            .map((id) => widgetsById.get(id))
            .filter((widget): widget is DashboardWidgetConfig => !!widget?.enabled);
        if (visibleWidgets.length !== orderedIds.length) {
            return;
        }

        const disabledWidgets = this.getSortedWidgets(this.state().widgets).filter(
            (widget) => !widget.enabled
        );

        const reordered = [...visibleWidgets, ...disabledWidgets].map(
            (widget, order) => ({
                ...widget,
                order,
            })
        );

        this.state.update((state) => ({
            ...state,
            widgets: reordered,
        }));
    }

    moveWidgetUp(widgetId: string): void {
        const sorted = this.getSortedWidgets(this.state().widgets);
        const index = sorted.findIndex((widget) => widget.id === widgetId);
        if (index <= 0) {
            return;
        }
        const previous = sorted[index - 1];
        const current = sorted[index];
        this.swapOrder(current.id, previous.id);
    }

    moveWidgetDown(widgetId: string): void {
        const sorted = this.getSortedWidgets(this.state().widgets);
        const index = sorted.findIndex((widget) => widget.id === widgetId);
        if (index === -1 || index >= sorted.length - 1) {
            return;
        }
        const next = sorted[index + 1];
        const current = sorted[index];
        this.swapOrder(current.id, next.id);
    }

    reset(): void {
        this.state.set(this.createDefaultState());
    }

    private swapOrder(firstId: string, secondId: string): void {
        const widgetMap = new Map(
            this.state().widgets.map((widget) => [widget.id, widget])
        );
        const first = widgetMap.get(firstId);
        const second = widgetMap.get(secondId);
        if (!first || !second) {
            return;
        }

        const firstOrder = first.order;
        this.state.update((state) => ({
            ...state,
            widgets: state.widgets.map((widget) => {
                if (widget.id === firstId) {
                    return { ...widget, order: second.order };
                }
                if (widget.id === secondId) {
                    return { ...widget, order: firstOrder };
                }
                return widget;
            }),
        }));
    }

    private updateWidget(
        widgetId: string,
        updater: (widget: DashboardWidgetConfig) => DashboardWidgetConfig
    ): void {
        this.state.update((state) => ({
            ...state,
            widgets: state.widgets.map((widget) =>
                widget.id === widgetId ? updater(widget) : widget
            ),
        }));
    }

    private loadState(): DashboardLayoutState {
        if (typeof localStorage === 'undefined') {
            return this.createDefaultState();
        }

        const raw = localStorage.getItem(DASHBOARD_LAYOUT_STORAGE_KEY);
        if (!raw) {
            return this.createDefaultState();
        }

        try {
            const parsed = JSON.parse(raw) as Partial<DashboardLayoutState>;
            if (!Array.isArray(parsed.widgets)) {
                return this.createDefaultState();
            }

            if (parsed.version === DASHBOARD_LAYOUT_VERSION) {
                return this.normalizeState(parsed.widgets);
            }

            const migrated = this.migrateState(parsed);
            if (migrated) {
                return migrated;
            }

            if (parsed.version == null) {
                return this.normalizeState(parsed.widgets);
            }

            return this.createDefaultState();
        } catch {
            return this.createDefaultState();
        }
    }

    private migrateState(
        state: Partial<DashboardLayoutState>
    ): DashboardLayoutState | null {
        if (!Array.isArray(state.widgets)) {
            return null;
        }

        const version = Number(state.version ?? 0);
        if (!Number.isFinite(version) || version <= 0) {
            return null;
        }

        if (version < DASHBOARD_LAYOUT_VERSION) {
            return this.normalizeState(state.widgets);
        }

        return null;
    }

    private normalizeState(
        widgets: DashboardWidgetConfig[]
    ): DashboardLayoutState {
        const widgetMap = new Map(widgets.map((widget) => [widget.id, widget]));
        const normalized = DEFAULT_DASHBOARD_WIDGETS.map((defaultWidget) => {
            const loaded = widgetMap.get(defaultWidget.id);
            if (!loaded) {
                return this.cloneWidget(defaultWidget);
            }

            return this.mergeWidget(defaultWidget, loaded);
        });

        return {
            version: DASHBOARD_LAYOUT_VERSION,
            widgets: this.getSortedWidgets(normalized).map((widget, index) => ({
                ...widget,
                order: index,
            })),
        };
    }

    private persistState(state: DashboardLayoutState): void {
        if (typeof localStorage === 'undefined') {
            return;
        }

        localStorage.setItem(DASHBOARD_LAYOUT_STORAGE_KEY, JSON.stringify(state));
    }

    private createDefaultState(): DashboardLayoutState {
        return {
            version: DASHBOARD_LAYOUT_VERSION,
            widgets: DEFAULT_DASHBOARD_WIDGETS.map((widget) =>
                this.cloneWidget(widget)
            ),
        };
    }

    private getSortedWidgets(
        widgets: DashboardWidgetConfig[]
    ): DashboardWidgetConfig[] {
        return [...widgets].sort((a, b) => a.order - b.order);
    }

    private cloneWidget(widget: DashboardWidgetConfig): DashboardWidgetConfig {
        return {
            ...widget,
            settings: widget.settings
                ? {
                      ...widget.settings,
                      scope: widget.settings.scope
                          ? this.normalizeScope(widget.settings.scope)
                          : undefined,
                  }
                : undefined,
        };
    }

    private mergeWidget(
        defaultWidget: DashboardWidgetConfig,
        loaded: DashboardWidgetConfig
    ): DashboardWidgetConfig {
        return {
            ...defaultWidget,
            ...loaded,
            size: this.normalizeSize(loaded.size ?? defaultWidget.size),
            settings: this.mergeSettings(defaultWidget, loaded),
        };
    }

    private mergeSettings(
        defaultWidget: DashboardWidgetConfig,
        loaded: DashboardWidgetConfig
    ) {
        if (!defaultWidget.settings && !loaded.settings) {
            return undefined;
        }

        return {
            ...defaultWidget.settings,
            ...loaded.settings,
            scope:
                loaded.settings?.scope || defaultWidget.settings?.scope
                    ? this.normalizeScope(
                          loaded.settings?.scope ?? defaultWidget.settings?.scope
                      )
                    : undefined,
        };
    }

    private normalizeScope(
        scope?: DashboardWidgetScopeSettings
    ): DashboardWidgetScopeSettings {
        const defaultScope = createDefaultWidgetScope();
        const rawProviders = Array.isArray(scope?.providers)
            ? scope.providers
            : defaultScope.providers;
        const providers = [...new Set(rawProviders)].filter(
            (provider): provider is DashboardWidgetProvider =>
                ALL_DASHBOARD_WIDGET_PROVIDERS.includes(
                    provider as DashboardWidgetProvider
                )
        );
        const playlistIds = [...new Set(scope?.playlistIds ?? [])].filter(Boolean);

        return {
            providers,
            playlistIds,
        };
    }

    private normalizeSize(size: unknown): DashboardWidgetSize {
        if (size === 's') {
            return 'one-third';
        }
        if (size === 'm') {
            return 'half';
        }
        if (size === 'l') {
            return 'full';
        }
        if (
            typeof size === 'string' &&
            DASHBOARD_WIDGET_SIZE_OPTIONS.includes(size as DashboardWidgetSize)
        ) {
            return size as DashboardWidgetSize;
        }
        return 'half';
    }

}
