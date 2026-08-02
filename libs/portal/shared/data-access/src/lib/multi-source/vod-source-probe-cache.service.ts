import { Injectable } from '@angular/core';
import type { VodSourceProbeResult } from '@iptvnator/shared/interfaces';

/**
 * How long a verdict may stand in for a fresh check. Long enough that closing
 * and reopening the popover — or leaving the movie and coming back — does not
 * re-fire a round of HEAD requests, short enough that "available" still means
 * something about the present.
 */
const PROBE_RESULT_TTL_MS = 10 * 60_000;

/**
 * Session-wide memory of availability checks, keyed by source id
 * (`playlistId:portalType:contentId` — i.e. per movie **and** per source).
 *
 * The per-movie controller dies with its detail page, so without this every
 * navigation away and back would silently forget what was just checked, and
 * "check all" would re-resolve and re-contact every foreign portal each time
 * the popover opens. Root-provided and in-memory only: a probe verdict is a
 * claim about the present, so persisting it across app launches would let a
 * stale "available" outlive the stream it described.
 */
@Injectable({ providedIn: 'root' })
export class VodSourceProbeCacheService {
    private readonly results = new Map<string, VodSourceProbeResult>();

    /**
     * Only settled verdicts are worth remembering. `unknown` means the check
     * could not run — caching it would suppress a retry that might succeed.
     */
    store(sourceId: string, result: VodSourceProbeResult): void {
        if (
            (result.status === 'ok' || result.status === 'fail') &&
            result.probedAt
        ) {
            this.results.set(sourceId, result);
        }
    }

    /** A stored verdict, if it is still fresh; expired entries are dropped. */
    get(sourceId: string): VodSourceProbeResult | null {
        const result = this.results.get(sourceId);
        if (!result?.probedAt) {
            return null;
        }

        const age = Date.now() - Date.parse(result.probedAt);
        if (!Number.isFinite(age) || age < 0 || age > PROBE_RESULT_TTL_MS) {
            this.results.delete(sourceId);
            return null;
        }

        return result;
    }
}
