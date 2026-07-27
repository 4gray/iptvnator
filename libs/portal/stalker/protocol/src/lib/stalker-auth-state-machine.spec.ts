import {
    StalkerAuthTransitionError,
    createStalkerAuthState,
    reduceStalkerAuthState,
} from './stalker-auth-state-machine';

function reachFirstProfile() {
    const resolving = reduceStalkerAuthState(createStalkerAuthState(), {
        type: 'start',
    });
    const handshaking = reduceStalkerAuthState(resolving, {
        type: 'endpoint-resolved',
    });
    return reduceStalkerAuthState(handshaking, {
        type: 'handshake-succeeded',
    });
}

describe('Stalker authentication state machine', () => {
    it('always enters the first profile with auth_second_step zero', () => {
        expect(reachFirstProfile()).toEqual({
            authSecondStep: 0,
            credentialAttempts: 0,
            stage: 'profile-first',
        });
    });

    it('permits do_auth only after profile status two', () => {
        expect(() =>
            reduceStalkerAuthState(reachFirstProfile(), {
                type: 'credentials-submitted',
            })
        ).toThrow(StalkerAuthTransitionError);

        const awaitingCredentials = reduceStalkerAuthState(
            reachFirstProfile(),
            {
                result: 'credentials-required',
                type: 'profile-classified',
            }
        );
        expect(
            reduceStalkerAuthState(awaitingCredentials, {
                type: 'credentials-submitted',
            })
        ).toMatchObject({ credentialAttempts: 1, stage: 'do-auth' });
    });

    it('permits the second profile only after canonical do_auth success', () => {
        const awaitingCredentials = reduceStalkerAuthState(
            reachFirstProfile(),
            {
                result: 'credentials-required',
                type: 'profile-classified',
            }
        );
        const doingAuth = reduceStalkerAuthState(awaitingCredentials, {
            type: 'credentials-submitted',
        });
        const secondProfile = reduceStalkerAuthState(doingAuth, {
            result: 'success',
            type: 'do-auth-classified',
        });

        expect(secondProfile).toEqual({
            authSecondStep: 1,
            credentialAttempts: 1,
            stage: 'profile-second',
        });
        expect(secondProfile.stage).not.toBe('ready');
        expect(
            reduceStalkerAuthState(secondProfile, {
                result: 'ready',
                type: 'profile-classified',
            })
        ).toMatchObject({ stage: 'ready' });
    });

    it('rejects the third explicit credential failure with the attempt limit', () => {
        let state = reduceStalkerAuthState(reachFirstProfile(), {
            result: 'credentials-required',
            type: 'profile-classified',
        });

        for (let attempt = 1; attempt <= 3; attempt += 1) {
            state = reduceStalkerAuthState(state, {
                type: 'credentials-submitted',
            });
            state = reduceStalkerAuthState(state, {
                result: 'credentials-rejected',
                type: 'do-auth-classified',
            });
        }

        expect(state).toEqual({
            credentialAttempts: 3,
            reason: 'credentials-attempt-limit',
            stage: 'rejected',
        });
    });

    it.each([
        'network-unreachable',
        'portal-protection-blocked',
        'rate-limited',
    ] as const)('preserves a %s failure', (reason) => {
        expect(
            reduceStalkerAuthState(reachFirstProfile(), {
                reason,
                type: 'failed',
            })
        ).toEqual({
            credentialAttempts: 0,
            reason,
            stage: 'failure',
        });
    });
});
