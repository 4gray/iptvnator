import { inject, Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { parentalLockSetKey } from '@iptvnator/shared/interfaces';
import { ParentalLockLockStore } from './parental-lock-lock-store.service';
import { ParentalLockService } from './parental-lock.service';

export interface ExternalSessionLaunch {
    readonly sourceId: string | null;
    readonly openedLocked: boolean;
    readonly lockKey: string;
}

const SOURCE_ROUTE = /^\/workspace\/(?:playlists|xtreams|stalker)\/([^/?#]+)/;
const MAX_COMPLETED_LAUNCHES = 64;

export function sourceIdOfRoute(url: string | undefined): string | null {
    const match = SOURCE_ROUTE.exec(url ?? '');
    return match ? decodeURIComponent(match[1]) : null;
}

/** Keeps launch-time lock information in the renderer; IPC carries only its ID. */
@Injectable({ providedIn: 'root' })
export class ParentalLockExternalLaunches {
    private readonly lock = inject(ParentalLockService);
    private readonly locks = inject(ParentalLockLockStore);
    private readonly router = inject(Router);
    private readonly pending = new Map<string, ExternalSessionLaunch>();
    private readonly completed = new Map<string, ExternalSessionLaunch>();

    capture(playlistId?: string): ExternalSessionLaunch {
        const sourceId = playlistId ?? sourceIdOfRoute(this.router.url);
        return {
            sourceId,
            openedLocked: this.lock.active(),
            lockKey: parentalLockSetKey(this.locks.lockSet(), sourceId),
        };
    }

    register(launch: ExternalSessionLaunch): string {
        const requestId = crypto.randomUUID();
        this.pending.set(requestId, launch);
        return requestId;
    }

    take(requestId: string): ExternalSessionLaunch | undefined {
        const launch =
            this.pending.get(requestId) ?? this.completed.get(requestId);
        this.pending.delete(requestId);
        this.completed.delete(requestId);
        return launch;
    }

    finish(requestId: string): void {
        const launch = this.pending.get(requestId);
        if (!launch) return;
        this.pending.delete(requestId);
        // An IPC reply can reach the renderer before its session event.
        this.completed.set(requestId, launch);
        if (this.completed.size > MAX_COMPLETED_LAUNCHES) {
            const oldest = this.completed.keys().next();
            if (!oldest.done) this.completed.delete(oldest.value);
        }
    }
}
