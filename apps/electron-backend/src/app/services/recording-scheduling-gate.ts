type RunExclusive = <T>(key: string, action: () => Promise<T>) => Promise<T>;

const GLOBAL_SCHEDULING_KEY = 'recording-scheduling:all';

export class RecordingSchedulingGate {
    private readonly blockedPlaylistIds = new Set<string>();
    private blockAllScheduling = false;

    constructor(private readonly runExclusive: RunExclusive) {}

    runForPlaylist<T>(
        playlistId: string,
        action: () => Promise<T>
    ): Promise<T> {
        return this.runExclusive(GLOBAL_SCHEDULING_KEY, () =>
            this.runExclusive(
                `recording-scheduling:playlist:${playlistId}`,
                action
            )
        );
    }

    blockPlaylistAndRun(
        playlistId: string,
        action: () => Promise<void>
    ): Promise<void> {
        return this.runForPlaylist(playlistId, async () => {
            this.blockedPlaylistIds.add(playlistId);
            try {
                await action();
            } catch (error) {
                this.restorePlaylist(playlistId);
                throw error;
            }
        });
    }

    blockAllAndRun(action: () => Promise<void>): Promise<void> {
        return this.runExclusive(GLOBAL_SCHEDULING_KEY, async () => {
            this.blockAllScheduling = true;
            await action();
        });
    }

    restorePlaylist(playlistId: string): void {
        this.blockedPlaylistIds.delete(playlistId);
    }

    resumeAll(): void {
        this.blockAllScheduling = false;
    }

    blockAll(): void {
        this.blockAllScheduling = true;
    }

    isBlocked(playlistId: string): boolean {
        return (
            this.blockAllScheduling || this.blockedPlaylistIds.has(playlistId)
        );
    }
}
