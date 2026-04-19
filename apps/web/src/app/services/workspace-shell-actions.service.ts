import { inject, Injectable, Provider } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { Router } from '@angular/router';
import {
    WORKSPACE_SHELL_ACTIONS,
    WorkspaceAccountInfoData,
    WorkspacePlaylistType,
    WorkspaceShellActions,
} from '@iptvnator/workspace/shell/util';

@Injectable({ providedIn: 'root' })
export class AppWorkspaceShellActionsService implements WorkspaceShellActions {
    private readonly dialog = inject(MatDialog);
    private readonly router = inject(Router);

    openAddPlaylistDialog(type?: WorkspacePlaylistType): void {
        void import('@iptvnator/playlist/import/feature').then(
            ({ AddPlaylistDialogComponent }) => {
                this.dialog.open(AddPlaylistDialogComponent, {
                    width: '560px',
                    maxWidth: '92vw',
                    data: type ? { type } : {},
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
        void this.router.navigate(['/workspace/global-recent']);
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
