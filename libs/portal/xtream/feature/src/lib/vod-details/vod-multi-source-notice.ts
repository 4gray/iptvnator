import { audioDiffersFactually } from '@iptvnator/portal/shared/data-access';
import type { VodSourceCandidate } from '@iptvnator/shared/interfaces';
import type { VodMultiSourceSwitchNotice } from './vod-multi-source-host.service';

/**
 * Builds what the user is told after a switch.
 *
 * A switch is never silent, so this always produces a notice. The dub warning
 * is deliberately conservative: it fires only when BOTH sides state an audio
 * track as fact, because warning on a guess would train people to ignore it.
 */
export function buildSwitchNotice(
    candidate: VodSourceCandidate,
    resolved: VodSourceCandidate,
    previous: VodSourceCandidate | null | undefined,
    resumeSeconds: number
): VodMultiSourceSwitchNotice {
    return {
        playlistName: candidate.playlistName,
        resumeSeconds,
        audioMayDiffer: audioDiffersFactually(previous, resolved),
        quality: resolved.quality?.value,
        container: resolved.container?.value,
    };
}
