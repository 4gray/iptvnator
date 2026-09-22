import { Injectable, inject } from '@angular/core';
import {
    DatabaseService,
    XtreamContent,
    XtreamImportStatus,
} from '@iptvnator/services';
import { PlaylistMeta } from '@iptvnator/shared/interfaces';
import {
    compareXtreamCatalogues,
    PlaylistComparisonContentType,
    PlaylistComparisonTypeResult,
} from './xtream-playlist-comparison';

export interface XtreamComparisonCatalogue {
    status: XtreamImportStatus;
    content: XtreamContent[];
}

@Injectable({ providedIn: 'root' })
export class XtreamPlaylistComparisonService {
    private readonly database = inject(DatabaseService);

    isXtream(playlist: PlaylistMeta): boolean {
        return (
            !!playlist.serverUrl && !!playlist.username && !!playlist.password
        );
    }

    async catalogue(
        playlistId: string,
        type: PlaylistComparisonContentType
    ): Promise<XtreamComparisonCatalogue> {
        const status = await this.database.getXtreamImportStatus(
            playlistId,
            type
        );
        if (status !== 'completed') return { status, content: [] };
        return {
            status,
            content: await this.database.getXtreamContent(playlistId, type),
        };
    }

    async compare(
        playlistA: string,
        playlistB: string,
        type: PlaylistComparisonContentType
    ): Promise<PlaylistComparisonTypeResult | null> {
        if (!playlistA || playlistA === playlistB) return null;
        const [a, b] = await Promise.all([
            this.catalogue(playlistA, type),
            this.catalogue(playlistB, type),
        ]);
        return a.status === 'completed' && b.status === 'completed'
            ? compareXtreamCatalogues(a.content, b.content, type)
            : null;
    }
}
