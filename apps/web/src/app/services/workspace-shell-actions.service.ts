import { inject, Injectable, Provider } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { PlaylistType } from '@iptvnator/playlist/shared/ui';
import {
    WORKSPACE_SHELL_ACTIONS,
    WorkspaceAccountInfoData,
    WorkspaceShellActions,
} from '@iptvnator/workspace/shell/util';

@Injectable({ providedIn: 'root' })
export class AppWorkspaceShellActionsService implements WorkspaceShellActions {
    private readonly dialog = inject(MatDialog);

    openAddPlaylistDialog(type: PlaylistType): void {
        void import('@iptvnator/playlist/import/feature').then(
            ({ AddPlaylistDialogComponent }) => {
                this.dialog.open(AddPlaylistDialogComponent, {
                    width: '600px',
                    data: { type },
                });
            }
        );
    }

    openGlobalSearch(initialQuery = ''): void {
        void import('@iptvnator/portal/xtream/feature').then(
            ({ GlobalSearchResultsComponent }) => {
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
        );
    }

    openGlobalRecent(): void {
        void import('@iptvnator/portal/xtream/feature').then(
            ({ GlobalRecentlyViewedComponent }) => {
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
        );
    }

    openAccountInfo(data: WorkspaceAccountInfoData): void {
        void import('@iptvnator/portal/xtream/feature').then(
            ({ AccountInfoComponent }) => {
                this.dialog.open(AccountInfoComponent, {
                    width: '80%',
                    maxWidth: '1200px',
                    maxHeight: '90vh',
                    data,
                });
            }
        );
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
