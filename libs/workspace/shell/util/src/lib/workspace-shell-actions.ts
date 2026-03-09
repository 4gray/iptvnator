import { InjectionToken } from '@angular/core';

export type WorkspacePlaylistType = 'xtream' | 'url' | 'text' | 'file' | 'stalker';

export interface WorkspaceAccountInfoData {
    vodStreamsCount: number;
    liveStreamsCount: number;
    seriesCount: number;
}

export interface WorkspaceShellActions {
    openAddPlaylistDialog(type: WorkspacePlaylistType): void;
    openGlobalSearch(initialQuery?: string): void;
    openGlobalRecent(): void;
    openAccountInfo(data: WorkspaceAccountInfoData): void;
}

export const WORKSPACE_SHELL_ACTIONS =
    new InjectionToken<WorkspaceShellActions>('WORKSPACE_SHELL_ACTIONS');
