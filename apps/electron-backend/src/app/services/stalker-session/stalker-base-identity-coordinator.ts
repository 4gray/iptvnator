import { normalizeStalkerMacAddress } from '@iptvnator/portal/stalker/protocol';

export interface StalkerBaseIdentitySnapshot {
    readonly epoch: number;
    readonly activePrincipal?: string;
}

export type StalkerCoordinatedReadResult<T> =
    | {
          readonly kind: 'completed';
          readonly snapshot: StalkerBaseIdentitySnapshot;
          readonly value: T;
      }
    | {
          readonly kind: 'suspended';
          readonly snapshot: StalkerBaseIdentitySnapshot;
      };

export interface StalkerCoordinatedMutationResult<T> {
    readonly snapshot: StalkerBaseIdentitySnapshot;
    readonly value: T;
}

interface ReadWaiter {
    readonly kind: 'read';
    readonly resolve: () => void;
}

interface WriteWaiter {
    readonly kind: 'write';
    readonly resolve: () => void;
}

type LockWaiter = ReadWaiter | WriteWaiter;

/**
 * A fair asynchronous read/write gate for one approved-origin + MAC pair.
 *
 * Catalog operations may share a read epoch. Every wire mutation advances the
 * epoch, runs alone, and either installs exactly one active principal or leaves
 * the base identity suspended when it fails.
 */
export class StalkerBaseIdentityCoordinator {
    #epoch = 0;
    #activePrincipal: string | undefined;
    #activeReaders = 0;
    #writerActive = false;
    readonly #waiters: LockWaiter[] = [];

    get snapshot(): StalkerBaseIdentitySnapshot {
        return createSnapshot(this.#epoch, this.#activePrincipal);
    }

    async runRead<T>(
        expectedPrincipal: string,
        expectedEpoch: number,
        operation: () => Promise<T>
    ): Promise<StalkerCoordinatedReadResult<T>> {
        validatePrincipal(expectedPrincipal);
        validateEpoch(expectedEpoch);
        await this.#acquireRead();
        try {
            if (
                this.#epoch !== expectedEpoch ||
                this.#activePrincipal !== expectedPrincipal
            ) {
                return {
                    kind: 'suspended',
                    snapshot: this.snapshot,
                };
            }

            const value = await operation();
            return {
                kind: 'completed',
                snapshot: this.snapshot,
                value,
            };
        } finally {
            this.#releaseRead();
        }
    }

    async runMutation<T>(
        nextPrincipal: string | undefined,
        operation: (mutationEpoch: number) => Promise<T>
    ): Promise<StalkerCoordinatedMutationResult<T>> {
        if (nextPrincipal !== undefined) {
            validatePrincipal(nextPrincipal);
        }
        await this.#acquireWrite();
        try {
            if (this.#epoch >= Number.MAX_SAFE_INTEGER) {
                throw new Error('stalker-coordinator-epoch-exhausted');
            }
            this.#epoch += 1;
            this.#activePrincipal = undefined;

            const value = await operation(this.#epoch);
            this.#activePrincipal = nextPrincipal;
            return {
                snapshot: this.snapshot,
                value,
            };
        } finally {
            this.#releaseWrite();
        }
    }

    async #acquireRead(): Promise<void> {
        if (!this.#writerActive && this.#waiters.length === 0) {
            this.#activeReaders += 1;
            return;
        }
        await new Promise<void>((resolve) => {
            this.#waiters.push({ kind: 'read', resolve });
        });
    }

    #releaseRead(): void {
        this.#activeReaders -= 1;
        if (this.#activeReaders < 0) {
            this.#activeReaders = 0;
            throw new Error('stalker-coordinator-read-underflow');
        }
        this.#drainWaiters();
    }

    async #acquireWrite(): Promise<void> {
        if (
            !this.#writerActive &&
            this.#activeReaders === 0 &&
            this.#waiters.length === 0
        ) {
            this.#writerActive = true;
            return;
        }
        await new Promise<void>((resolve) => {
            this.#waiters.push({ kind: 'write', resolve });
        });
    }

    #releaseWrite(): void {
        if (!this.#writerActive) {
            throw new Error('stalker-coordinator-write-underflow');
        }
        this.#writerActive = false;
        this.#drainWaiters();
    }

    #drainWaiters(): void {
        if (this.#writerActive || this.#activeReaders > 0) {
            return;
        }

        const first = this.#waiters[0];
        if (!first) {
            return;
        }
        if (first.kind === 'write') {
            this.#waiters.shift();
            this.#writerActive = true;
            first.resolve();
            return;
        }

        while (this.#waiters[0]?.kind === 'read') {
            const reader = this.#waiters.shift() as ReadWaiter;
            this.#activeReaders += 1;
            reader.resolve();
        }
    }
}

/**
 * Process-local registry. The key deliberately excludes endpoint path,
 * identity revision, playlist, and principal because portals may rotate a
 * single server-side token for the whole origin/MAC pair.
 */
export class StalkerBaseIdentityCoordinatorPool {
    readonly #coordinators = new Map<
        string,
        StalkerBaseIdentityCoordinator
    >();

    get size(): number {
        return this.#coordinators.size;
    }

    get(
        approvedPortalUrl: string,
        macAddress: string
    ): StalkerBaseIdentityCoordinator {
        const key = createBaseIdentityKey(approvedPortalUrl, macAddress);
        const existing = this.#coordinators.get(key);
        if (existing) {
            return existing;
        }
        const coordinator = new StalkerBaseIdentityCoordinator();
        this.#coordinators.set(key, coordinator);
        return coordinator;
    }

    clear(): void {
        this.#coordinators.clear();
    }
}

function createBaseIdentityKey(
    approvedPortalUrl: string,
    macAddress: string
): string {
    let url: URL;
    try {
        url = new URL(approvedPortalUrl);
    } catch {
        throw new Error('invalid-url');
    }
    if (
        (url.protocol !== 'http:' && url.protocol !== 'https:') ||
        url.username !== '' ||
        url.password !== ''
    ) {
        throw new Error('invalid-url');
    }
    const normalizedMac = normalizeStalkerMacAddress(macAddress);
    return JSON.stringify([url.origin, normalizedMac]);
}

function validatePrincipal(principal: string): void {
    if (
        principal.length === 0 ||
        principal.length > 256 ||
        /[\u0000-\u001f\u007f]/.test(principal)
    ) {
        throw new Error('invalid-stalker-principal');
    }
}

function validateEpoch(epoch: number): void {
    if (!Number.isSafeInteger(epoch) || epoch < 0) {
        throw new Error('invalid-stalker-coordinator-epoch');
    }
}

function createSnapshot(
    epoch: number,
    activePrincipal: string | undefined
): StalkerBaseIdentitySnapshot {
    return Object.freeze({
        ...(activePrincipal === undefined ? {} : { activePrincipal }),
        epoch,
    });
}
