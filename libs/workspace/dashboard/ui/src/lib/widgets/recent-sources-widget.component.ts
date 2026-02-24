import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { DashboardDataService } from 'workspace-dashboard-data-access';
import { DashboardWidgetShellComponent } from './dashboard-widget-shell.component';

@Component({
    selector: 'app-recent-sources-widget',
    imports: [RouterLink, DashboardWidgetShellComponent, TranslatePipe],
    templateUrl: './recent-sources-widget.component.html',
    styleUrl: './recent-sources-widget.component.scss',
})
export class RecentSourcesWidgetComponent {
    readonly data = inject(DashboardDataService);
}
