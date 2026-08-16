import { InjectionToken } from '@angular/core';
import type {
    StalkerAccountInfoDialogData,
    XtreamAccountInfoDialogData,
} from '@iptvnator/shared/interfaces';

export type WorkspacePlaylistType =
    | 'xtream'
    | 'url'
    | 'text'
    | 'file'
    | 'stalker'
    | 'auto';
export type PlaylistCategory = 'm3u' | 'xtream' | 'stalker';
export type M3uSubType = 'url' | 'file' | 'text';

export type WorkspaceAccountInfoData = XtreamAccountInfoDialogData;
export type WorkspaceStalkerAccountInfoData = StalkerAccountInfoDialogData;

export interface WorkspaceShellActions {
    openAddPlaylistDialog(type?: WorkspacePlaylistType): void;
    openGlobalSearch(initialQuery?: string): void;
    openGlobalRecent(): void;
    openAccountInfo(data: WorkspaceAccountInfoData): void;
    openStalkerAccountInfo(data: WorkspaceStalkerAccountInfoData): void;
}

export const WORKSPACE_SHELL_ACTIONS =
    new InjectionToken<WorkspaceShellActions>('WORKSPACE_SHELL_ACTIONS');
