import { Component, input } from '@angular/core';
import { MatCardModule } from '@angular/material/card';

@Component({
    selector: 'app-dashboard-widget-shell',
    imports: [MatCardModule],
    templateUrl: './dashboard-widget-shell.component.html',
    styleUrl: './dashboard-widget-shell.component.scss',
})
export class DashboardWidgetShellComponent {
    readonly eyebrow = input.required<string>();
    readonly title = input.required<string>();
}
