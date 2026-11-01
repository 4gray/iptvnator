import { Injectable } from '@angular/core';
import type {
    PlaylistMeta,
    XtreamCatalogStateResult,
} from '@iptvnator/shared/interfaces';

export class XtreamCatalogConnectionChangedError extends Error {
    override name = 'XtreamCatalogConnectionChangedError';
    constructor() {
        super(
            'The source connection changed during the scan. Reopen its editor and retry.'
        );
    }
}

/** Only constructed by the SQLite-backed edit-time scanner. */
@Injectable({ providedIn: 'root' })
export class XtreamCatalogCommitService {
    private condition(playlist: PlaylistMeta) {
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
                this.condition(playlist)
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
                this.condition(playlist)
            )
        );
    }
}
