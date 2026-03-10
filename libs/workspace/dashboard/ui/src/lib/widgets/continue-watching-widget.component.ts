import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { startWith } from 'rxjs';
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
    private readonly translate = inject(TranslateService);
    private readonly languageTick = toSignal(
        this.translate.onLangChange.pipe(startWith(null)),
        { initialValue: null }
    );

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
        this.languageTick();

        const date = new Date(dateStr);
        if (Number.isNaN(date.getTime())) {
            return this.translate.instant('WORKSPACE.DASHBOARD.RECENTLY');
        }

        const diffMinutes = Math.floor((Date.now() - date.getTime()) / 60_000);
        if (diffMinutes < 1) {
            return this.translate.instant('WORKSPACE.DASHBOARD.JUST_NOW');
        }
        if (diffMinutes < 60) {
            return this.translate.instant('WORKSPACE.DASHBOARD.MINUTES_AGO', {
                count: diffMinutes,
            });
        }

        const diffHours = Math.floor(diffMinutes / 60);
        if (diffHours < 24) {
            return this.translate.instant('WORKSPACE.DASHBOARD.HOURS_AGO', {
                count: diffHours,
            });
        }

        return this.translate.instant('WORKSPACE.DASHBOARD.DAYS_AGO', {
            count: Math.floor(diffHours / 24),
        });
    }
}
