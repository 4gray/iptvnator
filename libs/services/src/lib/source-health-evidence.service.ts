import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';
import {
    PlaylistMeta,
    SourceHealthResult,
    SourceProbeContext,
} from '@iptvnator/shared/interfaces';
import type { DataService } from './data.service';

@Injectable({ providedIn: 'root' })
export class SourceHealthEvidenceService {
    /** Committed desktop inventory changes; an absent ID resets the inventory. */
    readonly connections = new Subject<{
        id?: string;
        playlist?: Partial<PlaylistMeta>;
    }>();
    readonly results = new Subject<{
        playlist: Partial<PlaylistMeta>;
        result: SourceHealthResult;
    }>();
}
/** A request-local facade: never mutates the shared transport or session. */
export function withSourceProbe(
    data: DataService,
    probe?: SourceProbeContext,
    signal?: AbortSignal
): DataService {
    if (!probe) return data;
    const facade = Object.create(data) as DataService;
    facade.sendIpcEvent = <T>(type: string, payload?: unknown) => {
        if (signal?.aborted)
            return Promise.reject(new Error('Source probe cancelled'));
        if (Date.now() >= probe.deadlineAt)
            return Promise.reject(new Error('Source probe deadline exceeded'));
        return data.sendIpcEvent<T>(type, {
            ...(payload as object),
            probe,
            silent: true,
        });
    };
    return facade;
}
