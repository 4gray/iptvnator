import { inject, Injectable, Provider } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { AddPlaylistDialogComponent } from '@iptvnator/playlist/import/feature';
import {
    AccountInfoComponent,
    GlobalRecentlyViewedComponent,
    GlobalSearchResultsComponent,
} from '@iptvnator/portal/xtream/feature';
import { PlaylistType } from 'components';
import {
    WORKSPACE_SHELL_ACTIONS,
    WorkspaceAccountInfoData,
    WorkspaceShellActions,
} from '@iptvnator/workspace/shell/util';

@Injectable({ providedIn: 'root' })
export class AppWorkspaceShellActionsService implements WorkspaceShellActions {
    private readonly dialog = inject(MatDialog);

    openAddPlaylistDialog(type: PlaylistType): void {
        this.dialog.open(AddPlaylistDialogComponent, {
            width: '600px',
            data: { type },
        });
    }

    openGlobalSearch(initialQuery = ''): void {
        this.dialog.open(GlobalSearchResultsComponent, {
            width: '100%',
            height: '100%',
            maxWidth: '100%',
            panelClass: 'global-search-overlay',
            data: {
                isGlobalSearch: true,
                initialQuery,
            },
        });
    }

    openGlobalRecent(): void {
        this.dialog.open(GlobalRecentlyViewedComponent, {
            width: '100%',
            height: '100%',
            maxWidth: '100%',
            panelClass: 'global-search-overlay',
            data: { isGlobal: true },
            hasBackdrop: true,
            disableClose: false,
        });
    }

    openAccountInfo(data: WorkspaceAccountInfoData): void {
        this.dialog.open(AccountInfoComponent, {
            width: '80%',
            maxWidth: '1200px',
            maxHeight: '90vh',
            data,
        });
    }
}

export function provideWorkspaceShellActions(): Provider[] {
    return [
        AppWorkspaceShellActionsService,
        {
            provide: WORKSPACE_SHELL_ACTIONS,
            useExisting: AppWorkspaceShellActionsService,
        },
    ];
}
