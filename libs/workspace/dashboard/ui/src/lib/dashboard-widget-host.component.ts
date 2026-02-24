import { Component, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { DashboardWidgetConfig } from 'workspace-dashboard-data-access';
import { ContinueWatchingWidgetComponent } from './widgets/continue-watching-widget.component';
import { GlobalFavoritesWidgetComponent } from './widgets/global-favorites-widget.component';
import { RecentSourcesWidgetComponent } from './widgets/recent-sources-widget.component';
import { RecentlyWatchedWidgetComponent } from './widgets/recently-watched-widget.component';
import { SourceStatsWidgetComponent } from './widgets/source-stats-widget.component';

@Component({
    selector: 'app-dashboard-widget-host',
    imports: [
        ContinueWatchingWidgetComponent,
        GlobalFavoritesWidgetComponent,
        RecentSourcesWidgetComponent,
        RecentlyWatchedWidgetComponent,
        SourceStatsWidgetComponent,
        TranslatePipe,
    ],
    templateUrl: './dashboard-widget-host.component.html',
    styleUrl: './dashboard-widget-host.component.scss',
})
export class DashboardWidgetHostComponent {
    readonly widget = input.required<DashboardWidgetConfig>();
}
