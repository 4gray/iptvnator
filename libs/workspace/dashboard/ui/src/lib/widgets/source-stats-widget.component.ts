import { Component, inject } from '@angular/core';
import { DashboardDataService } from 'workspace-dashboard-data-access';
import { DashboardWidgetShellComponent } from './dashboard-widget-shell.component';

@Component({
    selector: 'app-source-stats-widget',
    imports: [DashboardWidgetShellComponent],
    templateUrl: './source-stats-widget.component.html',
    styleUrl: './source-stats-widget.component.scss',
})
export class SourceStatsWidgetComponent {
    readonly data = inject(DashboardDataService);
}
