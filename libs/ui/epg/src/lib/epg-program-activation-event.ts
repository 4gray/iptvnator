import type { EpgProgram } from '@iptvnator/shared/interfaces';

export interface EpgProgramActivationEvent {
    program: EpgProgram;
    type: 'live' | 'timeshift' | 'copy-catchup-url' | 'download-catchup';
}

/** Keep archive actions independent from selection and playback actions. */
export function isAllowedArchiveAction(
    action: EpgProgramActivationEvent['type'] | undefined,
    canCatchUp: boolean,
    canDownload: boolean
): action is 'copy-catchup-url' | 'download-catchup' {
    return (
        canCatchUp &&
        (action === 'copy-catchup-url' ||
            (action === 'download-catchup' && canDownload))
    );
}
