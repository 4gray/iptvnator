import { Injectable } from '@angular/core';
import {
    normalizeXtreamServerUrl,
    type PlaylistMeta,
    type XtreamCatalogStateResult,
} from '@iptvnator/shared/interfaces';

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

export async function persistXtreamStartupUpdateDate(
    playlist: PlaylistMeta,
    updateDate: number
): Promise<boolean> {
    const result = await window.electron.dbUpdatePlaylist(
        playlist._id,
        { updateDate },
        {
            ...catalogCondition(playlist),
            previousUpdateDate: playlist.updateDate ?? null,
        }
    );
    return result.success === true;
}

/** Only constructed by the SQLite-backed edit-time scanner. */
@Injectable({ providedIn: 'root' })
export class XtreamCatalogCommitService {
    async readCurrent(playlistId: string): Promise<PlaylistMeta> {
        const current = await window.electron.dbGetAppPlaylist(playlistId);
        if (!current || current._id !== playlistId)
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
