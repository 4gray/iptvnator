import { MonoTypeOperatorFunction } from 'rxjs';
import { EpgProgramCache } from './epg-program-cache';
import { EpgRuntimeBridgeService } from './epg-runtime-bridge.service';

/** Everything the lookups need from `EpgService`, and nothing else. */
export interface EpgLookupContext {
    readonly bridge: EpgRuntimeBridgeService;
    readonly cache: EpgProgramCache;
    /** Retires work that a changed XMLTV source set has invalidated. */
    guard<T>(): MonoTypeOperatorFunction<T>;
    /** Current EPG display offset, in minutes. */
    offsetMinutes(): number;
    /** Wall-clock now, expressed in the provider's uncorrected EPG clock. */
    clockMs(): number;
    /** Settings-managed XMLTV URLs, optionally minus a caller's own scope. */
    globalSourceUrls(excluding?: string[]): string[];
}
