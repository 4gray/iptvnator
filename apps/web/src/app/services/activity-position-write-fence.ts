import type { PlaybackPositionData } from '@iptvnator/shared/interfaces';

type PositionKey = Partial<
    Pick<PlaybackPositionData, 'contentType' | 'contentXtreamId'>
>;

/** A delayed fallback must not overwrite a newer invocation for the same item. */
export class ActivityPositionWriteFence {
    private readonly pending = new Map<string, object>();

    start(sourceId: string, position: PositionKey) {
        const key = this.key(sourceId, position);
        const token = {};
        this.pending.set(key, token);
        const current = () => this.pending.get(key) === token;
        return {
            current,
            finish: () => {
                if (current()) this.pending.delete(key);
            },
        };
    }

    supersede(method: string, args: unknown[]): void {
        let positions: PositionKey[];
        if (method === 'savePlaybackPosition')
            positions = [args[1] as PositionKey];
        else if (
            method === 'savePlaybackPositionsBatch' ||
            method === 'clearPlaybackPositionsBatch'
        )
            positions = args[1] as PositionKey[];
        else if (method === 'clearPlaybackPosition')
            positions = [
                {
                    contentXtreamId: args[1] as number,
                    contentType: args[2] as 'vod' | 'episode',
                },
            ];
        else return;
        for (const position of positions)
            this.pending.delete(this.key(args[0] as string, position));
    }

    private key(sourceId: string, position: PositionKey): string {
        return JSON.stringify([
            sourceId,
            position.contentType,
            position.contentXtreamId,
        ]);
    }
}
