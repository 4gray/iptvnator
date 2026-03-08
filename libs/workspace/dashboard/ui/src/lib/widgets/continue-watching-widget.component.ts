import { Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import {
    DashboardDataService,
    GlobalRecentItem,
} from 'workspace-dashboard-data-access';
import { DashboardWidgetShellComponent } from './dashboard-widget-shell.component';

@Component({
    selector: 'app-continue-watching-widget',
    imports: [
        MatButtonModule,
        MatIcon,
        RouterLink,
        DashboardWidgetShellComponent,
        TranslatePipe,
    ],
    templateUrl: './continue-watching-widget.component.html',
    styleUrl: './continue-watching-widget.component.scss',
})
export class ContinueWatchingWidgetComponent {
    readonly data = inject(DashboardDataService);

    /** The most recently watched item across all sources. */
    readonly lastItem = computed<GlobalRecentItem | null>(
        () => this.data.globalRecentItems()[0] ?? null
    );

    hasImage(item: GlobalRecentItem): boolean {
        return !!item.poster_url;
    }

    getLink(item: GlobalRecentItem): string[] {
        return this.data.getRecentItemLink(item);
    }

    typeIcon(type: GlobalRecentItem['type']): string {
        if (type === 'live') return 'live_tv';
        if (type === 'movie') return 'movie';
        return 'video_library';
    }

    typeKey(type: GlobalRecentItem['type']): string {
        if (type === 'live') return 'WORKSPACE.DASHBOARD.TYPE_LIVE';
        if (type === 'movie') return 'WORKSPACE.DASHBOARD.TYPE_MOVIE';
        return 'WORKSPACE.DASHBOARD.TYPE_SERIES';
    }

    relativeTime(dateStr: string): string {
        const diffMs = Date.now() - new Date(dateStr).getTime();
        const diffMin = Math.floor(diffMs / 60_000);
        if (diffMin < 1) return 'Just now';
        if (diffMin < 60) return `${diffMin}m ago`;
        const diffH = Math.floor(diffMin / 60);
        if (diffH < 24) return `${diffH}h ago`;
        return `${Math.floor(diffH / 24)}d ago`;
    }
}
