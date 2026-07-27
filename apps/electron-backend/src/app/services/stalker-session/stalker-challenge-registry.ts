import { randomBytes } from 'node:crypto';

const CHALLENGE_TTL_MS = 120_000;
const CHALLENGE_RANDOM_BYTES = 32;
const MAX_ACTIVE_CHALLENGES = 4_096;
const MAX_REFERENCE_GENERATION_ATTEMPTS = 4;

export interface StalkerOriginApprovalChallenge {
    kind: 'origin-approval';
    sourceOrigin: string;
    finalOrigin: string;
    landingPath: string;
}

export interface StalkerCredentialsChallenge {
    kind: 'credentials';
    attemptNumber: number;
    constrainedUsername?: string;
    savedCredentialsRejected?: boolean;
}

export type StalkerChallenge =
    | StalkerOriginApprovalChallenge
    | StalkerCredentialsChallenge;

export interface StalkerChallengeConsumeRequest {
    senderId: number;
    attemptRef: string;
    challengeRef: string;
    responseKind: StalkerChallenge['kind'];
}

export type StalkerChallengeConsumeResult =
    | {
          kind: 'consumed';
          challenge: StalkerChallenge;
      }
    | { kind: 'invalid' };

interface StalkerChallengeRecord {
    senderId: number;
    attemptRef: string;
    expiresAt: number;
    challenge: StalkerChallenge;
}

export interface StalkerChallengeRegistryOptions {
    now?: () => number;
    random?: (size: number) => Buffer;
}

/**
 * Owns opaque one-shot continuation capabilities in Electron main.
 *
 * No reference or challenge payload is enumerable or serializable. Callers
 * should return only the generated reference through the typed IPC boundary.
 */
export class StalkerChallengeRegistry {
    readonly #records = new Map<string, StalkerChallengeRecord>();
    readonly #attempts = new Map<number, Map<string, Set<string>>>();
    readonly #senderRefs = new Map<number, Set<string>>();
    readonly #now: () => number;
    readonly #random: (size: number) => Buffer;

    constructor(options: StalkerChallengeRegistryOptions = {}) {
        this.#now = options.now ?? Date.now;
        this.#random = options.random ?? randomBytes;
    }

    get size(): number {
        this.#pruneExpired();
        return this.#records.size;
    }

    issue(
        senderId: number,
        attemptRef: string,
        challenge: StalkerChallenge
    ): string {
        validateOwner(senderId, attemptRef);
        this.#pruneExpired();
        if (this.#records.size >= MAX_ACTIVE_CHALLENGES) {
            throw new Error('stalker-challenge-capacity-exceeded');
        }

        const challengeRef = this.#createUniqueReference();
        this.#records.set(challengeRef, {
            attemptRef,
            challenge: cloneChallenge(challenge),
            expiresAt: this.#now() + CHALLENGE_TTL_MS,
            senderId,
        });
        addReference(
            getOrCreateSet(
                getOrCreateMap(this.#attempts, senderId),
                attemptRef
            ),
            challengeRef
        );
        addReference(
            getOrCreateSet(this.#senderRefs, senderId),
            challengeRef
        );
        return challengeRef;
    }

    consume(
        request: StalkerChallengeConsumeRequest
    ): StalkerChallengeConsumeResult {
        const record = this.#records.get(request.challengeRef);
        if (!record) {
            return { kind: 'invalid' };
        }
        if (record.expiresAt <= this.#now()) {
            this.#deleteReference(request.challengeRef, record);
            return { kind: 'invalid' };
        }
        if (
            record.senderId !== request.senderId ||
            record.attemptRef !== request.attemptRef ||
            record.challenge.kind !== request.responseKind
        ) {
            return { kind: 'invalid' };
        }

        this.#deleteReference(request.challengeRef, record);
        return {
            challenge: cloneChallenge(record.challenge),
            kind: 'consumed',
        };
    }

    invalidateAttempt(senderId: number, attemptRef: string): void {
        const senderAttempts = this.#attempts.get(senderId);
        const refs = senderAttempts?.get(attemptRef);
        if (!refs) {
            return;
        }

        for (const ref of [...refs]) {
            const record = this.#records.get(ref);
            if (record) {
                this.#deleteReference(ref, record);
            }
        }
    }

    invalidateSender(senderId: number): void {
        const refs = this.#senderRefs.get(senderId);
        if (!refs) {
            return;
        }

        for (const ref of [...refs]) {
            const record = this.#records.get(ref);
            if (record) {
                this.#deleteReference(ref, record);
            }
        }
    }

    #createUniqueReference(): string {
        for (
            let attempt = 0;
            attempt < MAX_REFERENCE_GENERATION_ATTEMPTS;
            attempt += 1
        ) {
            const bytes = this.#random(CHALLENGE_RANDOM_BYTES);
            if (bytes.byteLength !== CHALLENGE_RANDOM_BYTES) {
                break;
            }
            const ref = bytes.toString('base64url');
            if (!this.#records.has(ref)) {
                return ref;
            }
        }
        throw new Error('stalker-challenge-reference-generation-failed');
    }

    #pruneExpired(): void {
        const now = this.#now();
        for (const [ref, record] of this.#records) {
            if (record.expiresAt <= now) {
                this.#deleteReference(ref, record);
            }
        }
    }

    #deleteReference(ref: string, record: StalkerChallengeRecord): void {
        this.#records.delete(ref);

        const senderRefs = this.#senderRefs.get(record.senderId);
        senderRefs?.delete(ref);
        if (senderRefs?.size === 0) {
            this.#senderRefs.delete(record.senderId);
        }

        const senderAttempts = this.#attempts.get(record.senderId);
        const attemptRefs = senderAttempts?.get(record.attemptRef);
        attemptRefs?.delete(ref);
        if (attemptRefs?.size === 0) {
            senderAttempts?.delete(record.attemptRef);
        }
        if (senderAttempts?.size === 0) {
            this.#attempts.delete(record.senderId);
        }
    }
}

function validateOwner(senderId: number, attemptRef: string): void {
    if (
        !Number.isSafeInteger(senderId) ||
        senderId < 0 ||
        attemptRef.length === 0 ||
        attemptRef.length > 256
    ) {
        throw new Error('invalid-stalker-challenge-owner');
    }
}

function cloneChallenge(challenge: StalkerChallenge): StalkerChallenge {
    return Object.freeze({ ...challenge });
}

function getOrCreateMap(
    map: Map<number, Map<string, Set<string>>>,
    key: number
): Map<string, Set<string>> {
    const existing = map.get(key);
    if (existing) {
        return existing;
    }
    const created = new Map<string, Set<string>>();
    map.set(key, created);
    return created;
}

function getOrCreateSet<Key>(
    map: Map<Key, Set<string>>,
    key: Key
): Set<string> {
    const existing = map.get(key);
    if (existing) {
        return existing;
    }
    const created = new Set<string>();
    map.set(key, created);
    return created;
}

function addReference(refs: Set<string>, ref: string): void {
    refs.add(ref);
}
