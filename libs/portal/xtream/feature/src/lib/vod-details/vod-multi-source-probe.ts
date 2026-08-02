import type {
    VodMultiSourceController,
    VodSourceResolverService,
} from '@iptvnator/portal/shared/data-access';
import type { StreamProbeService } from '@iptvnator/services';
import type { VodSourceProbeResult } from '@iptvnator/shared/interfaces';

/**
 * The on-demand availability check for a single row.
 *
 * Two awaits happen here — resolving a URL, then contacting it — and the user
 * can open another movie in between. Writing either result into the
 * replacement controller would attach a stale verdict to an unrelated source,
 * so the session is revalidated after each one.
 */
export interface ProbeSourceDeps {
    controller: VodMultiSourceController;
    resolver: Pick<VodSourceResolverService, 'resolve'>;
    probes: Pick<StreamProbeService, 'probe'>;
    session: number;
    isCurrent: (session: number) => boolean;
    publish: () => void;
    /**
     * Remembers settled verdicts across controller lifetimes, so reopening
     * the movie does not re-contact every foreign portal. Written even when
     * the session moved on — the verdict is about the source, not the page.
     */
    cacheResult?: (sourceId: string, result: VodSourceProbeResult) => void;
}

export async function probeSource(
    sourceId: string,
    deps: ProbeSourceDeps
): Promise<void> {
    const { controller, session, isCurrent, publish } = deps;
    const candidate = controller.findSource(sourceId);
    if (!candidate) {
        return;
    }

    controller.setProbe(sourceId, { status: 'probing' });
    publish();

    const resolved = await deps.resolver.resolve(candidate);
    if (!isCurrent(session)) {
        return;
    }

    if (!resolved) {
        // No URL could be built — that is "cannot check", not "this is dead".
        controller.setProbe(sourceId, { status: 'unknown' });
        publish();
        return;
    }

    controller.updateSource(resolved.candidate);
    // Probe the way this playlist actually plays: a panel that requires its
    // own User-Agent, Referer or Origin refuses a bare request, and calling a
    // working stream unavailable would poison the failover ranking too.
    const result = await deps.probes.probe(
        resolved.playback.streamUrl,
        'HEAD',
        {
            userAgent: resolved.playback.userAgent,
            referer: resolved.playback.referer,
            origin: resolved.playback.origin,
        }
    );
    deps.cacheResult?.(sourceId, result);
    if (!isCurrent(session)) {
        return;
    }

    controller.setProbe(sourceId, result);
    publish();
}
