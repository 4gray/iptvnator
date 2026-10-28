import { NavigationEnd, type Router } from '@angular/router';
import { filter, take } from 'rxjs';

type IdleScheduler = (run: () => void, options: { timeout: number }) => number;

/**
 * The web players (video.js, hls.js, mpegts.js, ArtPlayer: about 2.8 MB) are
 * not on the first route, so the first screen renders without them. Load them
 * once that screen has rendered and the page is idle: the first list or portal
 * then opens as fast as when they came with the boot.
 */
export function warmPlayerChunk(
    router: Pick<Router, 'events'>,
    load: () => Promise<unknown> = () =>
        import('@iptvnator/playlist/m3u/feature-player'),
    schedule: (run: () => void) => void = afterSettling
): void {
    router.events
        .pipe(
            filter((event) => event instanceof NavigationEnd),
            take(1)
        )
        .subscribe(() =>
            schedule(() => {
                // A failed warm-up is retried by the route that needs it.
                load().catch(() => undefined);
            })
        );
}

function afterSettling(run: () => void): void {
    const idle = (globalThis as { requestIdleCallback?: IdleScheduler })
        .requestIdleCallback;
    setTimeout(() => {
        if (idle) {
            idle(run, { timeout: 5000 });
        } else {
            run();
        }
    }, 1000);
}
