import type { EpgProgram } from '@iptvnator/shared/interfaces';

export interface EpgProgramActivationEvent {
    program: EpgProgram;
    type: 'live' | 'timeshift';
}
