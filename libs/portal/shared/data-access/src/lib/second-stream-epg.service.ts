import { inject, Injectable } from '@angular/core';
import { EpgService } from '@iptvnator/epg/data-access';
import { normalizeEpgUrls } from '@iptvnator/shared/m3u-utils';
import type { EpgProgram } from '@iptvnator/shared/interfaces';
import {
    collectionEpgKey,
    type UnifiedCollectionItem,
} from '@iptvnator/portal/shared/util';
import { firstValueFrom } from 'rxjs';
import { StreamResolverService } from './collection/stream-resolver.service';
import type { SecondStreamChannel } from './second-stream-catalog.service';

@Injectable({ providedIn: 'root' })
export class SecondStreamEpgService {
    private readonly epg = inject(EpgService);
    private readonly resolver = inject(StreamResolverService);
    readonly xmltvAvailable$ = this.epg.epgAvailable$;

    async load(
        rows: readonly SecondStreamChannel[]
    ): Promise<Map<string, EpgProgram | null>> {
        const result = new Map<string, EpgProgram | null>();
        const xmltv = new Map<
            string,
            { sourceUrls: string[]; rows: SecondStreamChannel[] }
        >();
        const portal: UnifiedCollectionItem[] = [];
        for (const row of rows) {
            if (row.item.sourceType !== 'm3u') {
                portal.push(row.item);
                continue;
            }
            const sourceUrls = normalizeEpgUrls(row.epgSourceUrls);
            const key = JSON.stringify(sourceUrls.slice().sort());
            const scope = xmltv.get(key) ?? { sourceUrls, rows: [] };
            scope.rows.push(row);
            xmltv.set(key, scope);
        }
        await Promise.all([
            ...Array.from(xmltv.values(), async ({ rows, sourceUrls }) => {
                const keys = rows
                    .map(({ item }) => collectionEpgKey(item))
                    .filter((key): key is string => key !== null);
                const programs = await firstValueFrom(
                    this.epg.getCurrentProgramsForChannels(keys, {
                        sourceUrls,
                    }),
                    { defaultValue: new Map<string, EpgProgram | null>() }
                );
                for (const { item } of rows) {
                    const key = collectionEpgKey(item);
                    result.set(item.uid, (key && programs.get(key)) || null);
                }
            }),
            portal.length &&
                this.resolver.loadEpgForItems(portal).then((programs) => {
                    for (const item of portal) {
                        const key = collectionEpgKey(item);
                        result.set(
                            item.uid,
                            (key && programs.get(key)) || null
                        );
                    }
                }),
        ]);
        return result;
    }
}
