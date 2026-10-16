import type { PlaybackPositionData } from '@iptvnator/shared/interfaces';

type Positions = Record<string, PlaybackPositionData[]>;

/** Loaded on demand. Every mutation reads fresh storage after loading the module. */
export class PwaPlaybackPositions {
    constructor(
        private readonly getPlaybackPositionsFromStorage: () => Positions,
        private readonly savePlaybackPositionsToStorage: (
            positions: Positions
        ) => void
    ) {}
    async savePlaybackPosition(
        playlistId: string,
        data: PlaybackPositionData
    ): Promise<void> {
        const allPositions = this.getPlaybackPositionsFromStorage();
        if (!allPositions[playlistId]) {
            allPositions[playlistId] = [];
        }

        // Remove existing entry if present
        allPositions[playlistId] = allPositions[playlistId].filter(
            (p) =>
                !(
                    p.contentXtreamId === data.contentXtreamId &&
                    p.contentType === data.contentType
                )
        );

        // Add new entry
        allPositions[playlistId].push({
            ...data,
            updatedAt: new Date().toISOString(),
        });

        this.savePlaybackPositionsToStorage(allPositions);
    }

    async getPlaybackPosition(
        playlistId: string,
        contentXtreamId: number,
        contentType: 'vod' | 'episode'
    ): Promise<PlaybackPositionData | null> {
        const allPositions = this.getPlaybackPositionsFromStorage();
        const playlistPositions = allPositions[playlistId] || [];

        return (
            playlistPositions.find(
                (p) =>
                    p.contentXtreamId === contentXtreamId &&
                    p.contentType === contentType
            ) || null
        );
    }

    async getSeriesPlaybackPositions(
        playlistId: string,
        seriesXtreamId: number
    ): Promise<PlaybackPositionData[]> {
        const allPositions = this.getPlaybackPositionsFromStorage();
        const playlistPositions = allPositions[playlistId] || [];

        return playlistPositions.filter(
            (p) =>
                p.contentType === 'episode' &&
                p.seriesXtreamId === seriesXtreamId
        );
    }

    async getRecentPlaybackPositions(
        playlistId: string,
        limit?: number
    ): Promise<PlaybackPositionData[]> {
        const allPositions = this.getPlaybackPositionsFromStorage();
        const playlistPositions = allPositions[playlistId] || [];

        // Sort by updatedAt descending
        playlistPositions.sort(
            (a, b) =>
                new Date(b.updatedAt ?? 0).getTime() -
                new Date(a.updatedAt ?? 0).getTime()
        );

        return limit ? playlistPositions.slice(0, limit) : playlistPositions;
    }

    async getAllPlaybackPositions(
        playlistId: string
    ): Promise<PlaybackPositionData[]> {
        const allPositions = this.getPlaybackPositionsFromStorage();
        return allPositions[playlistId] || [];
    }

    async clearPlaybackPosition(
        playlistId: string,
        contentXtreamId: number,
        contentType: 'vod' | 'episode'
    ): Promise<void> {
        const allPositions = this.getPlaybackPositionsFromStorage();
        if (allPositions[playlistId]) {
            allPositions[playlistId] = allPositions[playlistId].filter(
                (p) =>
                    !(
                        p.contentXtreamId === contentXtreamId &&
                        p.contentType === contentType
                    )
            );
            this.savePlaybackPositionsToStorage(allPositions);
        }
    }

    async savePlaybackPositionsBatch(
        playlistId: string,
        items: PlaybackPositionData[]
    ): Promise<void> {
        if (items.length === 0) {
            return;
        }

        // One blob read + one write for the whole batch — the blob holds
        // every playlist's positions, so per-item saves would re-serialize
        // it N times.
        const allPositions = this.getPlaybackPositionsFromStorage();
        const playlistPositions = allPositions[playlistId] ?? [];
        const updatedAt = new Date().toISOString();

        const replacedKeys = new Set(
            items.map((item) => `${item.contentType}_${item.contentXtreamId}`)
        );
        allPositions[playlistId] = [
            ...playlistPositions.filter(
                (p) =>
                    !replacedKeys.has(`${p.contentType}_${p.contentXtreamId}`)
            ),
            ...items.map((item) => ({ ...item, updatedAt })),
        ];

        this.savePlaybackPositionsToStorage(allPositions);
    }

    async clearPlaybackPositionsBatch(
        playlistId: string,
        items: { contentXtreamId: number; contentType: 'vod' | 'episode' }[]
    ): Promise<void> {
        if (items.length === 0) {
            return;
        }

        const allPositions = this.getPlaybackPositionsFromStorage();
        const playlistPositions = allPositions[playlistId];
        if (!playlistPositions) {
            return;
        }

        const removedKeys = new Set(
            items.map((item) => `${item.contentType}_${item.contentXtreamId}`)
        );
        allPositions[playlistId] = playlistPositions.filter(
            (p) => !removedKeys.has(`${p.contentType}_${p.contentXtreamId}`)
        );

        this.savePlaybackPositionsToStorage(allPositions);
    }
}
