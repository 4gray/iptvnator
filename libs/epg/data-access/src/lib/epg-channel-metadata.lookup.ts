import { MonoTypeOperatorFunction, Observable, from, of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { EpgChannelMetadata } from '@iptvnator/shared/interfaces';
import { EpgRuntimeBridgeService } from './epg-runtime-bridge.service';

/**
 * Channel icons and display names from the imported XMLTV, resolved with the
 * same playlist-first, Settings-managed-fallback strategy as the programme
 * lookups: a playlist-local guide that only supplies programmes must still
 * let icons come from a global source.
 *
 * Extracted from `EpgService` to keep that file under the repository's
 * production size limit; it carries no state of its own.
 */
export class EpgChannelMetadataLookup {
    constructor(
        private readonly epgBridge: EpgRuntimeBridgeService,
        private readonly guard: <T>() => MonoTypeOperatorFunction<T>,
        private readonly globalSourceUrls: (excluding?: string[]) => string[]
    ) {}

    forChannels(
        normalizedChannelIds: string[],
        sourceUrls: string[]
    ): Observable<Map<string, EpgChannelMetadata | null>> {
        const globalSourceUrls =
            sourceUrls.length > 0
                ? this.globalSourceUrls(sourceUrls)
                : this.globalSourceUrls();
        const effectiveSourceUrls =
            sourceUrls.length > 0 ? sourceUrls : globalSourceUrls;

        return this.forSourceUrls(
            normalizedChannelIds,
            effectiveSourceUrls
        ).pipe(
            this.guard<Map<string, EpgChannelMetadata | null>>(),
            switchMap((metadataMap) => {
                const fallbackChannelIds =
                    sourceUrls.length > 0 && globalSourceUrls.length > 0
                        ? normalizedChannelIds.filter(
                              (channelId) => !metadataMap.get(channelId)
                          )
                        : [];

                if (fallbackChannelIds.length === 0) {
                    return of(metadataMap);
                }

                return this.forSourceUrls(
                    fallbackChannelIds,
                    globalSourceUrls
                ).pipe(
                    this.guard<Map<string, EpgChannelMetadata | null>>(),
                    map((globalMetadataMap) => {
                        fallbackChannelIds.forEach((channelId) => {
                            metadataMap.set(
                                channelId,
                                globalMetadataMap.get(channelId) ?? null
                            );
                        });
                        return metadataMap;
                    }),
                    catchError((err) => {
                        console.error(
                            'EPG global fallback channel metadata error:',
                            err
                        );
                        return of(metadataMap);
                    })
                );
            })
        );
    }

    private forSourceUrls(
        channelIds: string[],
        sourceUrls: string[]
    ): Observable<Map<string, EpgChannelMetadata | null>> {
        return from(
            this.epgBridge.getChannelMetadata(
                channelIds,
                sourceUrls.length > 0 ? { sourceUrls } : undefined
            )
        ).pipe(
            this.guard<Record<string, EpgChannelMetadata | null> | null>(),
            map((metadataByChannelId) => {
                return new Map<string, EpgChannelMetadata | null>(
                    channelIds.map((channelId) => [
                        channelId,
                        metadataByChannelId?.[channelId] ?? null,
                    ])
                );
            }),
            catchError((err) => {
                console.error('EPG get channel metadata error:', err);
                return of(new Map<string, EpgChannelMetadata | null>());
            })
        );
    }
}
