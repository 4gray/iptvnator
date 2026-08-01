import type { Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import type { ActivatedRoute } from '@angular/router';
import { distinctUntilChanged, map, scan } from 'rxjs';
import type { OfflineDetailRouteContext } from './download-offline-file-coordinator.service';
import { parseOfflineDownloadId } from './download-offline-detail.presentation';

export function createDownloadOfflineRouteContext(
    route: ActivatedRoute
): Signal<OfflineDetailRouteContext> {
    return toSignal(
        route.paramMap.pipe(
            map((params) => parseOfflineDownloadId(params.get('downloadId'))),
            distinctUntilChanged(),
            scan<number | undefined, OfflineDetailRouteContext>(
                (previous, downloadId) => ({
                    downloadId,
                    generation: previous.generation + 1,
                }),
                { generation: 0 }
            )
        ),
        {
            initialValue: {
                downloadId: parseOfflineDownloadId(
                    route.snapshot.paramMap.get('downloadId')
                ),
                generation: 0,
            },
        }
    );
}
