import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { DashboardDataService } from 'workspace-dashboard-data-access';
import { DashboardWidgetShellComponent } from './dashboard-widget-shell.component';

@Component({
    selector: 'app-continue-watching-widget',
    imports: [MatButtonModule, MatIcon, RouterLink, DashboardWidgetShellComponent],
    templateUrl: './continue-watching-widget.component.html',
    styleUrl: './continue-watching-widget.component.scss',
})
export class ContinueWatchingWidgetComponent {
    readonly data = inject(DashboardDataService);
}
