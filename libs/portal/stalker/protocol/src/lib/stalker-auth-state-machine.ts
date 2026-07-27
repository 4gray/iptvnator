import {
    STALKER_CONNECTION_STAGES,
    STALKER_FAILURE_REASONS,
} from './stalker-protocol.constants';
import type {
    StalkerConnectionStage,
    StalkerFailureReason,
} from './stalker-protocol.types';

export interface StalkerAuthState {
    stage: StalkerConnectionStage;
    credentialAttempts: number;
    authSecondStep?: 0 | 1;
    reason?: StalkerFailureReason;
}

export type StalkerAuthTransitionEvent =
    | { type: 'start' }
    | { type: 'origin-approval-required' }
    | { type: 'origin-approved' }
    | { type: 'endpoint-resolved' }
    | { type: 'handshake-succeeded' }
    | {
          type: 'profile-classified';
          result: 'ready' | 'blocked' | 'credentials-required';
      }
    | { type: 'credentials-submitted' }
    | {
          type: 'do-auth-classified';
          result: 'success' | 'credentials-rejected';
      }
    | { type: 'failed'; reason: StalkerFailureReason };

export class StalkerAuthTransitionError extends Error {
    constructor(stage: StalkerConnectionStage, event: string) {
        super(`Invalid Stalker auth transition: ${stage} -> ${event}`);
        this.name = 'StalkerAuthTransitionError';
    }
}

export function createStalkerAuthState(): StalkerAuthState {
    return {
        credentialAttempts: 0,
        stage: STALKER_CONNECTION_STAGES.New,
    };
}

export function reduceStalkerAuthState(
    state: StalkerAuthState,
    event: StalkerAuthTransitionEvent
): StalkerAuthState {
    if (event.type === 'failed') {
        return {
            credentialAttempts: state.credentialAttempts,
            reason: event.reason,
            stage: STALKER_CONNECTION_STAGES.Failure,
        };
    }

    if (event.type === 'start' && state.stage === STALKER_CONNECTION_STAGES.New) {
        return withStage(state, STALKER_CONNECTION_STAGES.Resolving);
    }
    if (
        event.type === 'origin-approval-required' &&
        state.stage === STALKER_CONNECTION_STAGES.Resolving
    ) {
        return withStage(
            state,
            STALKER_CONNECTION_STAGES.AwaitingOriginApproval
        );
    }
    if (
        event.type === 'origin-approved' &&
        state.stage === STALKER_CONNECTION_STAGES.AwaitingOriginApproval
    ) {
        return withStage(state, STALKER_CONNECTION_STAGES.Handshaking);
    }
    if (
        event.type === 'endpoint-resolved' &&
        state.stage === STALKER_CONNECTION_STAGES.Resolving
    ) {
        return withStage(state, STALKER_CONNECTION_STAGES.Handshaking);
    }
    if (
        event.type === 'handshake-succeeded' &&
        state.stage === STALKER_CONNECTION_STAGES.Handshaking
    ) {
        return {
            authSecondStep: 0,
            credentialAttempts: state.credentialAttempts,
            stage: STALKER_CONNECTION_STAGES.ProfileFirst,
        };
    }
    if (event.type === 'profile-classified') {
        return reduceProfileResult(state, event.result);
    }
    if (
        event.type === 'credentials-submitted' &&
        state.stage === STALKER_CONNECTION_STAGES.AwaitingCredentials
    ) {
        return {
            credentialAttempts: state.credentialAttempts + 1,
            stage: STALKER_CONNECTION_STAGES.DoAuth,
        };
    }
    if (
        event.type === 'do-auth-classified' &&
        state.stage === STALKER_CONNECTION_STAGES.DoAuth
    ) {
        if (event.result === 'success') {
            return {
                authSecondStep: 1,
                credentialAttempts: state.credentialAttempts,
                stage: STALKER_CONNECTION_STAGES.ProfileSecond,
            };
        }
        return credentialRejection(state);
    }

    throw new StalkerAuthTransitionError(state.stage, event.type);
}

function reduceProfileResult(
    state: StalkerAuthState,
    result: 'ready' | 'blocked' | 'credentials-required'
): StalkerAuthState {
    if (
        state.stage !== STALKER_CONNECTION_STAGES.ProfileFirst &&
        state.stage !== STALKER_CONNECTION_STAGES.ProfileSecond
    ) {
        throw new StalkerAuthTransitionError(state.stage, 'profile-classified');
    }
    if (result === 'ready') {
        return withStage(state, STALKER_CONNECTION_STAGES.Ready);
    }
    if (result === 'blocked') {
        return {
            credentialAttempts: state.credentialAttempts,
            reason: STALKER_FAILURE_REASONS.AccountOrDeviceBlocked,
            stage: STALKER_CONNECTION_STAGES.Rejected,
        };
    }
    return state.credentialAttempts >= 3
        ? credentialRejection(state)
        : withStage(state, STALKER_CONNECTION_STAGES.AwaitingCredentials);
}

function credentialRejection(state: StalkerAuthState): StalkerAuthState {
    if (state.credentialAttempts >= 3) {
        return {
            credentialAttempts: state.credentialAttempts,
            reason: STALKER_FAILURE_REASONS.CredentialsAttemptLimit,
            stage: STALKER_CONNECTION_STAGES.Rejected,
        };
    }
    return withStage(state, STALKER_CONNECTION_STAGES.AwaitingCredentials);
}

function withStage(
    state: StalkerAuthState,
    stage: StalkerConnectionStage
): StalkerAuthState {
    return {
        credentialAttempts: state.credentialAttempts,
        stage,
    };
}
