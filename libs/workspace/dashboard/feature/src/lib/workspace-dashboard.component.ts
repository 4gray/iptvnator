import {
    CdkDragDrop,
    DragDropModule,
    moveItemInArray,
} from '@angular/cdk/drag-drop';
import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { startWith } from 'rxjs';
import {
    DashboardLayoutService,
    DashboardWidgetConfig,
    DashboardWidgetSize,
} from 'workspace-dashboard-data-access';
import { DashboardWidgetHostComponent } from 'workspace-dashboard-ui';

@Component({
    selector: 'app-workspace-dashboard',
    imports: [
        DashboardWidgetHostComponent,
        DragDropModule,
        MatButtonModule,
        MatIcon,
        MatSlideToggleModule,
        MatTooltip,
        TranslatePipe,
    ],
    templateUrl: './workspace-dashboard.component.html',
    styleUrl: './workspace-dashboard.component.scss',
})
export class WorkspaceDashboardComponent {
    private readonly translate = inject(TranslateService);

    readonly editMode = signal(false);
    private readonly languageTick = toSignal(
        this.translate.onLangChange.pipe(startWith(null)),
        { initialValue: null }
    );
    private readonly sizeOrder: DashboardWidgetSize[] = [
        'one-third',
        'half',
        'two-thirds',
        'full',
    ];

    readonly allWidgets = computed(() =>
        [...this.layoutService.state().widgets].sort(
            (a, b) => a.order - b.order
        )
    );
    readonly visibleWidgets = computed(() =>
        this.allWidgets().filter((widget) => widget.enabled)
    );

    constructor(readonly layoutService: DashboardLayoutService) {
        // Data reload is handled reactively by DashboardDataService
        // via Router NavigationEnd events
    }

    toggleEditMode(): void {
        this.editMode.update((value) => !value);
    }

    onWidgetDrop(event: CdkDragDrop<DashboardWidgetConfig[]>): void {
        if (event.previousIndex === event.currentIndex) {
            return;
        }
        const reordered = [...this.visibleWidgets()];
        moveItemInArray(reordered, event.previousIndex, event.currentIndex);
        this.layoutService.reorderVisibleWidgets(
            reordered.map((widget) => widget.id)
        );
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

    cycleWidgetSize(widgetId: string, dir: 1 | -1): void {
        const widget = this.allWidgets().find((w) => w.id === widgetId);
        if (!widget) return;
        const idx = this.sizeOrder.indexOf(widget.size);
        const next = this.sizeOrder[idx + dir];
        if (next) this.layoutService.setWidgetSize(widgetId, next);
    }

    getSizeLabel(size: DashboardWidgetSize): string {
        this.languageTick();

        const labels: Record<DashboardWidgetSize, string> = {
            'one-third': '1/3',
            half: '1/2',
            'two-thirds': '2/3',
            full: this.translateText('WORKSPACE.DASHBOARD.SIZE_FULL'),
        };
        return labels[size];
    }

    isFirstSize(size: DashboardWidgetSize): boolean {
        return this.sizeOrder.indexOf(size) === 0;
    }

    isLastSize(size: DashboardWidgetSize): boolean {
        return this.sizeOrder.indexOf(size) === this.sizeOrder.length - 1;
    }

    hideWidget(widgetId: string): void {
        this.layoutService.toggleWidget(widgetId);
    }

    getWidgetTitle(widget: DashboardWidgetConfig): string {
        this.languageTick();
        return this.translateText(widget.title);
    }

    getWidgetDescription(widget: DashboardWidgetConfig): string {
        this.languageTick();
        return this.translateText(widget.description);
    }

    getDragWidgetLabel(widget: DashboardWidgetConfig): string {
        return this.translateText('WORKSPACE.DASHBOARD.DRAG_WIDGET', {
            title: this.getWidgetTitle(widget),
        });
    }

    getHideWidgetLabel(widget: DashboardWidgetConfig): string {
        return this.translateText('WORKSPACE.DASHBOARD.HIDE_WIDGET', {
            title: this.getWidgetTitle(widget),
        });
    }

    private translateText(
        key: string,
        params?: Record<string, string | number>
    ): string {
        return this.translate.instant(key, params);
    }
}
