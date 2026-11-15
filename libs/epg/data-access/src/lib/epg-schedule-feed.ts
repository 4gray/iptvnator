import type { EpgProgram } from '@iptvnator/shared/interfaces';
import type {
    EpgPreferencesService,
    EpgSourceSettingsService,
} from '@iptvnator/services';
import { from, of, type BehaviorSubject } from 'rxjs';
import { catchError, map, timeout } from 'rxjs/operators';
import type { EpgRuntimeBridgeService } from './epg-runtime-bridge.service';
import { normalizeEpgPrograms } from './epg-program-normalization.util';

/**
 * The open channel's schedule (`EpgService.currentEpgPrograms$`): read on a
 * zap, and read again when the stored EPG changes. Loaded with the first
 * channel opened, so it stays off the startup path.
 *
 * Reads are numbered; one publishes only while its channel is still open and
 * nothing newer has published. A failed read publishes nothing, so it cannot
 * discard an older read still on its way. A refill runs in the background (an
 * import may still be writing): it asks the backend to reject instead of
 * answering an unreadable database with an empty schedule, and a failed or
 * slow refill keeps the schedule on screen and raises no toast.
 */
export class EpgScheduleFeed {
    private channelId: string | null = null;
    private request = 0;
    private published = 0;

    /**
     * Positional, not an options object: the call sits in `EpgService` on
     * the startup path, where every byte counts (`renderer.initialBytes`).
     */
    constructor(
        private readonly bridge: EpgRuntimeBridgeService,
        private readonly sourceSettings: EpgSourceSettingsService,
        private readonly preferences: EpgPreferencesService,
        private readonly programs: BehaviorSubject<EpgProgram[]>,
        private readonly available: BehaviorSubject<boolean>,
        /** The generic EPG failure toast. */
        private readonly toast: () => void
    ) {}

    read(channelId: string, refill = false): void {
        // Recorded even while EPG is off: turning it on refills this channel,
        // not the one open before it was switched off.
        this.channelId = channelId;
        const { bridge, preferences, sourceSettings } = this;
        if (!preferences.enabled() || !bridge.supportsProgramLookup) return;
        const request = ++this.request;
        const canPublish = () =>
            channelId === this.channelId && request > this.published;

        from(
            bridge.getChannelPrograms(
                channelId,
                refill ? { rejectOnError: true } : undefined
            )
        )
            .pipe(
                sourceSettings.guard(),
                preferences.guard(),
                timeout(3000),
                map((programs) => normalizeEpgPrograms(programs ?? [])),
                catchError((err) => {
                    console.error('EPG get programs error:', err);
                    if (refill || !canPublish()) return of(null);
                    this.published = request;
                    this.toast();
                    this.programs.next([]);
                    this.available.next(false);
                    return of(null);
                })
            )
            .subscribe((programs) => {
                if (!programs || !canPublish()) return;
                this.published = request;
                this.available.next(programs.length > 0);
                this.programs.next(programs);
            });
    }

    /** Read the open channel again (the stored EPG changed). */
    refill(): void {
        if (this.channelId) this.read(this.channelId, true);
    }

    /** A channel without an EPG key was opened: nothing left to refill. */
    clear(): void {
        this.channelId = null;
        this.published = ++this.request;
    }
}
