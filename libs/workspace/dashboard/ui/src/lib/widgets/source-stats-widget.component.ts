import { Component, inject } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { TranslatePipe } from '@ngx-translate/core';
import { DashboardDataService } from 'workspace-dashboard-data-access';
import { DashboardWidgetShellComponent } from './dashboard-widget-shell.component';

@Component({
    selector: 'app-source-stats-widget',
    imports: [
        DashboardWidgetShellComponent,
        TranslatePipe,
        MatIcon,
        MatProgressSpinnerModule,
    ],
    templateUrl: './source-stats-widget.component.html',
    styleUrl: './source-stats-widget.component.scss',
})
export class SourceStatsWidgetComponent {
    readonly data = inject(DashboardDataService);
}
