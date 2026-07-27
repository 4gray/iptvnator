import type {
    VodMultiSourceController,
    VodSourceResolverService,
} from '@iptvnator/portal/shared/data-access';
import type { StreamProbeService } from '@iptvnator/services';

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
    const result = await deps.probes.probe(resolved.playback.streamUrl);
    if (!isCurrent(session)) {
        return;
    }

    controller.setProbe(sourceId, result);
    publish();
}
