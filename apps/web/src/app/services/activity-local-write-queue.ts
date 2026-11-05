import type { PlaybackPositionData } from '@iptvnator/shared/interfaces';

/** Serialize raw writes per item, without letting a rejected write stall later points. */
export class ActivityLocalWriteQueue {
    private readonly writes = new Map<
        string,
        { sourceId: string; task: Promise<void> }
    >();
    async run(
        sourceId: string,
        position: PlaybackPositionData,
        write: () => Promise<void>
    ): Promise<void> {
        const key = JSON.stringify([
            sourceId,
            position.contentType,
            position.contentXtreamId,
        ]);
        const previous = this.writes.get(key)?.task ?? Promise.resolve();
        const task = previous.catch(() => undefined).then(write);
        this.writes.set(key, { sourceId, task });
        try {
            await task;
        } finally {
            if (this.writes.get(key)?.task === task) this.writes.delete(key);
        }
    }
    async wait(sourceId: string): Promise<void> {
        await Promise.all(
            [...this.writes.values()]
                .filter((entry) => entry.sourceId === sourceId)
                .map((entry) => entry.task)
        );
    }
}
