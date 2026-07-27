import { StalkerChallengeRegistry } from './stalker-challenge-registry';

describe('StalkerChallengeRegistry', () => {
    let now: number;
    let registry: StalkerChallengeRegistry;

    beforeEach(() => {
        now = Date.parse('2026-07-27T12:00:00.000Z');
        registry = new StalkerChallengeRegistry({ now: () => now });
    });

    it('creates cryptographically opaque origin and credential references', () => {
        const originRef = registry.issue(41, 'attempt-secret', {
            finalOrigin: 'https://redirect.example',
            kind: 'origin-approval',
            landingPath: '/customer/c/',
            sourceOrigin: 'https://source.example',
        });
        const credentialRef = registry.issue(41, 'attempt-secret', {
            attemptNumber: 1,
            constrainedUsername: 'account-secret',
            kind: 'credentials',
        });

        expect(originRef).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(credentialRef).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(originRef).not.toBe(credentialRef);
        for (const fragment of [
            '41',
            'attempt',
            'redirect',
            'customer',
            'account',
        ]) {
            expect(originRef).not.toContain(fragment);
            expect(credentialRef).not.toContain(fragment);
        }
    });

    it('binds a challenge to its renderer without letting a foreign renderer consume it', () => {
        const ref = registry.issue(41, 'attempt-a', {
            attemptNumber: 1,
            kind: 'credentials',
        });

        expect(
            registry.consume({
                attemptRef: 'attempt-a',
                challengeRef: ref,
                responseKind: 'credentials',
                senderId: 42,
            })
        ).toEqual({ kind: 'invalid' });
        expect(
            registry.consume({
                attemptRef: 'attempt-a',
                challengeRef: ref,
                responseKind: 'credentials',
                senderId: 41,
            })
        ).toEqual({
            challenge: {
                attemptNumber: 1,
                kind: 'credentials',
            },
            kind: 'consumed',
        });
    });

    it('binds a challenge to its exact connection attempt', () => {
        const ref = registry.issue(41, 'attempt-a', {
            attemptNumber: 1,
            kind: 'credentials',
        });

        expect(
            registry.consume({
                attemptRef: 'attempt-b',
                challengeRef: ref,
                responseKind: 'credentials',
                senderId: 41,
            })
        ).toEqual({ kind: 'invalid' });
        expect(
            registry.consume({
                attemptRef: 'attempt-a',
                challengeRef: ref,
                responseKind: 'credentials',
                senderId: 41,
            }).kind
        ).toBe('consumed');
    });

    it('requires the response kind issued for the challenge', () => {
        const ref = registry.issue(41, 'attempt-a', {
            finalOrigin: 'https://redirect.example',
            kind: 'origin-approval',
            landingPath: '/c/',
            sourceOrigin: 'https://source.example',
        });

        expect(
            registry.consume({
                attemptRef: 'attempt-a',
                challengeRef: ref,
                responseKind: 'credentials',
                senderId: 41,
            })
        ).toEqual({ kind: 'invalid' });
        expect(
            registry.consume({
                attemptRef: 'attempt-a',
                challengeRef: ref,
                responseKind: 'origin-approval',
                senderId: 41,
            }).kind
        ).toBe('consumed');
    });

    it('consumes a challenge exactly once', () => {
        const ref = registry.issue(41, 'attempt-a', {
            attemptNumber: 1,
            kind: 'credentials',
        });
        const request = {
            attemptRef: 'attempt-a',
            challengeRef: ref,
            responseKind: 'credentials' as const,
            senderId: 41,
        };

        expect(registry.consume(request).kind).toBe('consumed');
        expect(registry.consume(request)).toEqual({ kind: 'invalid' });
    });

    it('expires a challenge after two minutes using the injected clock', () => {
        const ref = registry.issue(41, 'attempt-a', {
            attemptNumber: 1,
            kind: 'credentials',
        });

        now += 120_000;

        expect(
            registry.consume({
                attemptRef: 'attempt-a',
                challengeRef: ref,
                responseKind: 'credentials',
                senderId: 41,
            })
        ).toEqual({ kind: 'invalid' });
        expect(registry.size).toBe(0);
    });

    it('invalidates every challenge when an attempt terminates', () => {
        const first = registry.issue(41, 'attempt-a', {
            attemptNumber: 1,
            kind: 'credentials',
        });
        registry.issue(41, 'attempt-a', {
            finalOrigin: 'https://redirect.example',
            kind: 'origin-approval',
            landingPath: '/c/',
            sourceOrigin: 'https://source.example',
        });
        registry.issue(41, 'attempt-b', {
            attemptNumber: 1,
            kind: 'credentials',
        });

        registry.invalidateAttempt(41, 'attempt-a');

        expect(
            registry.consume({
                attemptRef: 'attempt-a',
                challengeRef: first,
                responseKind: 'credentials',
                senderId: 41,
            })
        ).toEqual({ kind: 'invalid' });
        expect(registry.size).toBe(1);
    });

    it('invalidates all challenges owned by a destroyed renderer', () => {
        registry.issue(41, 'attempt-a', {
            attemptNumber: 1,
            kind: 'credentials',
        });
        registry.issue(41, 'attempt-b', {
            attemptNumber: 2,
            kind: 'credentials',
        });
        registry.issue(42, 'attempt-c', {
            attemptNumber: 1,
            kind: 'credentials',
        });

        registry.invalidateSender(41);

        expect(registry.size).toBe(1);
    });

    it('does not expose enumerable challenge state', () => {
        registry.issue(41, 'attempt-a', {
            attemptNumber: 1,
            kind: 'credentials',
        });

        expect(JSON.stringify(registry)).toBe('{}');
        expect(Object.keys(registry)).toEqual([]);
    });
});
