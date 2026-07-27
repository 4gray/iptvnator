import { audioDiffersFactually } from '@iptvnator/portal/shared/data-access';
import {
    playlistDisplayLabel,
    type VodSourceCandidate,
} from '@iptvnator/shared/interfaces';

/** What a switch tells the user. Lives with the code that builds it. */
export interface VodMultiSourceSwitchNotice {
    playlistName: string;
    resumeSeconds: number;
    /** Both sides state an audio track AS FACT and those facts differ. */
    audioMayDiffer: boolean;
    quality?: string;
    container?: string;
}

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
        // Safe by construction, not by call site: users routinely name a
        // playlist after the URL they pasted, credentials and all, and this
        // string goes into a toast that sits over the video.
        playlistName: playlistDisplayLabel(
            candidate.playlistName,
            candidate.playlistId
        ),
        resumeSeconds,
        audioMayDiffer: audioDiffersFactually(previous, resolved),
        quality: resolved.quality?.value,
        container: resolved.container?.value,
    };
}
