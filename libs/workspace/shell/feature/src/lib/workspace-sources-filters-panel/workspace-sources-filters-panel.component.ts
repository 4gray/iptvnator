import {
    ChangeDetectionStrategy,
    Component,
    computed,
    inject,
} from '@angular/core';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { Store } from '@ngrx/store';
import { TranslatePipe } from '@ngx-translate/core';
import { selectAllPlaylistsMeta } from '@iptvnator/m3u-state';
import {
    SourceStatusService,
    sourceStatusBucket,
} from '@iptvnator/portal/shared/data-access';
import { SourceRemovalService } from '@iptvnator/playlist/shared/ui';
import {
    countSourcesByStatus,
    countSourcesByType,
    SourceBucketOf,
    SourcesStatusFilter,
    SourcesTypeFilter,
    SourcesViewStateService,
} from '@iptvnator/playlist/shared/util';
import { SOURCE_TYPE_ICONS } from '@iptvnator/shared/interfaces';
import {
    WORKSPACE_SHELL_ACTIONS,
    WorkspaceShellContextDrawerService,
} from '@iptvnator/workspace/shell/util';

interface TypeOption {
    id: SourcesTypeFilter;
    icon: string;
    labelKey: string;
}

interface StatusOption {
    id: SourcesStatusFilter;
    labelKey: string;
}

/**
 * The Sources side list: Type and, on desktop where source health is known,
 * Status. Both are single-choice and combine; each group counts within the
 * other group's choice.
 */
@Component({
    selector: 'app-workspace-sources-filters-panel',
    imports: [MatIcon, MatIconButton, MatTooltip, TranslatePipe],
    templateUrl: './workspace-sources-filters-panel.component.html',
    styleUrl: './workspace-sources-filters-panel.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkspaceSourcesFiltersPanelComponent {
    private readonly store = inject(Store);
    private readonly statusService = inject(SourceStatusService);
    private readonly removal = inject(SourceRemovalService);
    private readonly viewState = inject(SourcesViewStateService);
    private readonly workspaceActions = inject(WORKSPACE_SHELL_ACTIONS, {
        optional: true,
    });
    // Root-provided; optional keeps standalone unit tests light. Picking a
    // filter never navigates, so the phone drawer closes to reveal the list.
    private readonly contextDrawer = inject(
        WorkspaceShellContextDrawerService,
        {
            optional: true,
        }
    );

    readonly typeOptions: readonly TypeOption[] = [
        { id: 'all', icon: 'layers', labelKey: 'WORKSPACE.SOURCES.ALL' },
        {
            id: 'm3u',
            icon: SOURCE_TYPE_ICONS.m3u,
            labelKey: 'HOME.PLAYLIST_TYPES.M3U',
        },
        {
            id: 'xtream',
            icon: SOURCE_TYPE_ICONS.xtream,
            labelKey: 'HOME.PLAYLIST_TYPES.XTREAM',
        },
        {
            id: 'stalker',
            icon: SOURCE_TYPE_ICONS.stalker,
            labelKey: 'HOME.PLAYLIST_TYPES.STALKER',
        },
    ];
    readonly statusOptions: readonly StatusOption[] = [
        { id: 'all', labelKey: 'WORKSPACE.SOURCES.STATUS_ANY' },
        { id: 'ok', labelKey: 'WORKSPACE.SOURCES.STATUS_OK' },
        { id: 'bad', labelKey: 'WORKSPACE.SOURCES.STATUS_BAD' },
    ];

    readonly showStatus = this.statusService.supportsStatusFilter;
    readonly filter = this.viewState.filter;

    private readonly allPlaylists = this.store.selectSignal(
        selectAllPlaylistsMeta
    );
    private readonly playlists = computed(() => {
        const pending = this.removal.pendingIds();
        return this.allPlaylists().filter(
            (playlist) => !pending.has(playlist._id)
        );
    });
    private readonly bucketOf: SourceBucketOf = (playlist) => {
        const status = this.statusService.statusOf(playlist);
        return status ? sourceStatusBucket(status.reachability) : null;
    };

    readonly total = computed(() => this.playlists().length);
    readonly typeCounts = computed(() =>
        countSourcesByType(
            this.playlists(),
            this.showStatus ? this.filter().status : 'all',
            this.bucketOf
        )
    );
    readonly statusCounts = computed(() =>
        countSourcesByStatus(
            this.playlists(),
            this.filter().type,
            this.bucketOf
        )
    );

    selectType(type: SourcesTypeFilter): void {
        this.viewState.setType(type);
        this.contextDrawer?.close();
    }

    selectStatus(status: SourcesStatusFilter): void {
        this.viewState.setStatus(status);
        this.contextDrawer?.close();
    }

    addPlaylist(): void {
        // On a phone the drawer is a focus-trapped modal of its own: it must
        // not stay open under the dialog.
        this.contextDrawer?.close();
        this.workspaceActions?.openAddPlaylistDialog();
    }
}
