import { Injectable } from '@angular/core';
import {
    normalizeXtreamContentTypes,
    normalizeXtreamServerUrl,
    type PlaylistMeta,
    type XtreamContentType,
    type XtreamCatalogStateResult,
} from '@iptvnator/shared/interfaces';
import type { DatabaseService } from './database-electron.service';

export function sameXtreamCatalogConnection(
    fetched: PlaylistMeta,
    accepted: PlaylistMeta
): boolean {
    const identity = (source: PlaylistMeta) => [
        normalizeXtreamServerUrl(source.serverUrl ?? ''),
        source.username?.trim() ?? '',
        source.password?.trim() ?? '',
        source.userAgent?.trim() ?? '',
    ];
    return (
        JSON.stringify(identity(fetched)) === JSON.stringify(identity(accepted))
    );
}

export function matchesXtreamStartupSource(
    queued: PlaylistMeta,
    current: PlaylistMeta | null
): current is PlaylistMeta {
    if (
        !current?.autoRefresh ||
        current.updateDate !== queued.updateDate ||
        !normalizeXtreamContentTypes(current.xtreamContentTypes).includes(
            'live'
        )
    )
        return false;
    try {
        return sameXtreamCatalogConnection(queued, current);
    } catch {
        return false;
    }
}

export class XtreamCatalogConnectionChangedError extends Error {
    override name = 'XtreamCatalogConnectionChangedError';
    constructor() {
        super(
            'The source connection changed during the scan. Reopen its editor and retry.'
        );
    }
}

function catalogCondition(playlist: PlaylistMeta) {
    return {
        playlistId: playlist._id,
        serverUrl: playlist.serverUrl ?? '',
        username: playlist.username ?? '',
        password: playlist.password ?? '',
        ...(typeof playlist.userAgent === 'string'
            ? { userAgent: playlist.userAgent }
            : {}),
    };
}

export function xtreamStartupRefreshCondition(playlist: PlaylistMeta) {
    return {
        ...catalogCondition(playlist),
        previousUpdateDate: playlist.updateDate ?? null,
    };
}

export async function completeXtreamStartupRefresh(
    playlist: PlaylistMeta,
    updateDate: number
): Promise<boolean> {
    const result = await window.electron.dbUpdatePlaylist(
        playlist._id,
        { updateDate },
        xtreamStartupRefreshCondition(playlist)
    );
    return result.success === true;
}

export async function markImportUnfinished(
    db: Pick<DatabaseService, 'setXtreamImportStatus'>,
    playlistId: string,
    type: XtreamContentType
): Promise<void> {
    if (!(await db.setXtreamImportStatus(playlistId, type, 'importing')))
        throw new Error('Could not retain unfinished catalog state.');
}

/** Only constructed by the SQLite-backed edit-time scanner. */
@Injectable({ providedIn: 'root' })
export class XtreamCatalogCommitService {
    async readCurrentOrNull(playlistId: string): Promise<PlaylistMeta | null> {
        const current = await window.electron.dbGetAppPlaylist(playlistId);
        return current?._id === playlistId ? current : null;
    }

    async readCurrent(playlistId: string): Promise<PlaylistMeta> {
        const current = await this.readCurrentOrNull(playlistId);
        if (!current)
            throw new Error('Could not read the current catalog connection.');
        return current;
    }

    private requireSuccess(result: XtreamCatalogStateResult): void {
        if (result?.connectionChanged)
            throw new XtreamCatalogConnectionChangedError();
        if (!result?.success || !result.conditionChecked)
            throw new Error(
                'Could not commit catalog recovery for its connection.'
            );
    }

    async assertCurrent(playlist: PlaylistMeta): Promise<void> {
        this.requireSuccess(
            await window.electron.dbCheckXtreamCatalogConnection(
                catalogCondition(playlist)
            )
        );
    }

    async setState(
        playlist: PlaylistMeta,
        key: string,
        value: string
    ): Promise<void> {
        this.requireSuccess(
            await window.electron.dbSetAppState(
                key,
                value,
                catalogCondition(playlist)
            )
        );
    }
}
