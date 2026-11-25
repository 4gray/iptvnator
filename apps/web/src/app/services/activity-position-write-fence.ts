import {
    playbackTimestamp,
    type PlaybackPositionData,
} from '@iptvnator/shared/interfaces';

type PositionKey = Partial<
    Pick<
        PlaybackPositionData,
        'contentType' | 'contentXtreamId' | 'nativeCheckpointAt'
    >
>;

/** A delayed fallback must not overwrite a newer invocation for the same item. */
export class ActivityPositionWriteFence {
    private readonly pending = new Map<
        string,
        { reset: boolean; capturedAt: number }
    >();

    blocksCheckpoint(sourceId: string, position: PositionKey): boolean {
        const pending = this.pending.get(this.key(sourceId, position));
        return (
            !!pending &&
            (pending.reset ||
                pending.capturedAt >
                    playbackTimestamp(position.nativeCheckpointAt))
        );
    }

    start(sourceId: string, position: PositionKey, reset = false) {
        const key = this.key(sourceId, position);
        const token = {
            reset,
            capturedAt: position.nativeCheckpointAt
                ? playbackTimestamp(position.nativeCheckpointAt)
                : Date.now(),
        };
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
