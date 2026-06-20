import { inject, Injectable, Provider } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { PORTAL_SHELL_ACTIONS } from '@iptvnator/portal/shared/util';
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
                    // Width sized for the 5-card method picker plus the
                    // selected method's form below. Matches the v0.22
                    // mockup; falls back to viewport-clamped width on
                    // narrow screens so the grid can collapse via the
                    // SCSS responsive breakpoints.
                    width: '780px',
                    maxWidth: '92vw',
                    data: type ? { type } : {},
                });
            }
        );
    }

    openGlobalSearch(initialQuery = ''): void {
        const query = initialQuery.trim();
        void this.router.navigate(['/workspace/search'], {
            queryParams: query ? { q: query } : {},
        });
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
        {
            provide: PORTAL_SHELL_ACTIONS,
            useExisting: AppWorkspaceShellActionsService,
        },
    ];
}
