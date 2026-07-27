import {
    StalkerBaseIdentityCoordinator,
    StalkerBaseIdentityCoordinatorPool,
} from './stalker-base-identity-coordinator';

function deferred<T = void>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, reject, resolve };
}

describe('StalkerBaseIdentityCoordinatorPool', () => {
    it('keys coordinators by approved origin and normalized MAC', () => {
        const pool = new StalkerBaseIdentityCoordinatorPool();

        const first = pool.get(
            'https://portal.example/customer/c/',
            '00-1a-79-00-00-01'
        );
        const sameBaseIdentity = pool.get(
            'https://portal.example/other/path',
            '00:1A:79:00:00:01'
        );
        const otherOrigin = pool.get(
            'https://other.example/customer/c/',
            '00:1A:79:00:00:01'
        );
        const otherMac = pool.get(
            'https://portal.example/customer/c/',
            '00:1A:79:00:00:02'
        );

        expect(sameBaseIdentity).toBe(first);
        expect(otherOrigin).not.toBe(first);
        expect(otherMac).not.toBe(first);
        expect(pool.size).toBe(3);
    });
});

describe('StalkerBaseIdentityCoordinator', () => {
    it('allows concurrent readers for the active principal and epoch', async () => {
        const coordinator = new StalkerBaseIdentityCoordinator();
        const ready = await coordinator.runMutation('principal-a', async () => {
            return 'authenticated';
        });
        const firstGate = deferred();
        const secondGate = deferred();
        const started: string[] = [];

        const first = coordinator.runRead(
            'principal-a',
            ready.snapshot.epoch,
            async () => {
                started.push('first');
                await firstGate.promise;
                return 1;
            }
        );
        const second = coordinator.runRead(
            'principal-a',
            ready.snapshot.epoch,
            async () => {
                started.push('second');
                await secondGate.promise;
                return 2;
            }
        );
        await Promise.resolve();

        expect(started).toEqual(['first', 'second']);
        firstGate.resolve();
        secondGate.resolve();
        await expect(Promise.all([first, second])).resolves.toEqual([
            {
                kind: 'completed',
                snapshot: { activePrincipal: 'principal-a', epoch: 1 },
                value: 1,
            },
            {
                kind: 'completed',
                snapshot: { activePrincipal: 'principal-a', epoch: 1 },
                value: 2,
            },
        ]);
    });

    it('runs mutations exclusively and does not admit later readers ahead of a writer', async () => {
        const coordinator = new StalkerBaseIdentityCoordinator();
        const ready = await coordinator.runMutation('principal-a', async () => {
            return undefined;
        });
        const readerGate = deferred();
        const mutationGate = deferred();
        const order: string[] = [];

        const reader = coordinator.runRead(
            'principal-a',
            ready.snapshot.epoch,
            async () => {
                order.push('reader-start');
                await readerGate.promise;
                order.push('reader-end');
            }
        );
        await Promise.resolve();
        const mutation = coordinator.runMutation('principal-a', async () => {
            order.push('mutation-start');
            await mutationGate.promise;
            order.push('mutation-end');
        });
        const laterReader = coordinator.runRead(
            'principal-a',
            ready.snapshot.epoch + 1,
            async () => {
                order.push('later-reader');
            }
        );

        await Promise.resolve();
        expect(order).toEqual(['reader-start']);
        readerGate.resolve();
        await reader;
        await Promise.resolve();
        expect(order).toEqual(['reader-start', 'reader-end', 'mutation-start']);
        mutationGate.resolve();
        await mutation;
        await laterReader;
        expect(order).toEqual([
            'reader-start',
            'reader-end',
            'mutation-start',
            'mutation-end',
            'later-reader',
        ]);
    });

    it('suspends stale epochs and inactive principals without running their operation', async () => {
        const coordinator = new StalkerBaseIdentityCoordinator();
        const first = await coordinator.runMutation(
            'principal-a',
            async () => undefined
        );
        const second = await coordinator.runMutation(
            'principal-b',
            async () => undefined
        );
        const operation = jest.fn();

        await expect(
            coordinator.runRead('principal-a', first.snapshot.epoch, operation)
        ).resolves.toEqual({
            kind: 'suspended',
            snapshot: { activePrincipal: 'principal-b', epoch: 2 },
        });
        await expect(
            coordinator.runRead('principal-b', first.snapshot.epoch, operation)
        ).resolves.toEqual({
            kind: 'suspended',
            snapshot: { activePrincipal: 'principal-b', epoch: 2 },
        });
        expect(second.snapshot.epoch).toBe(2);
        expect(operation).not.toHaveBeenCalled();
    });

    it('keeps alternating principals isolated behind monotonic mutation epochs', async () => {
        const coordinator = new StalkerBaseIdentityCoordinator();
        const events: string[] = [];

        const first = await coordinator.runMutation(
            'principal-a',
            async (epoch) => {
                events.push(`auth-a-${epoch}`);
            }
        );
        const second = await coordinator.runMutation(
            'principal-b',
            async (epoch) => {
                events.push(`auth-b-${epoch}`);
            }
        );
        const third = await coordinator.runMutation(
            'principal-a',
            async (epoch) => {
                events.push(`reauth-a-${epoch}`);
            }
        );

        expect(events).toEqual(['auth-a-1', 'auth-b-2', 'reauth-a-3']);
        expect(first.snapshot.epoch).toBe(1);
        expect(second.snapshot.epoch).toBe(2);
        expect(third.snapshot).toEqual({
            activePrincipal: 'principal-a',
            epoch: 3,
        });
    });

    it('advances the epoch and suspends all principals after a failed mutation', async () => {
        const coordinator = new StalkerBaseIdentityCoordinator();
        const ready = await coordinator.runMutation(
            'principal-a',
            async () => undefined
        );

        await expect(
            coordinator.runMutation('principal-b', async () => {
                throw new Error('authentication-failed');
            })
        ).rejects.toThrow('authentication-failed');

        expect(coordinator.snapshot).toEqual({ epoch: 2 });
        await expect(
            coordinator.runRead('principal-a', ready.snapshot.epoch, jest.fn())
        ).resolves.toEqual({
            kind: 'suspended',
            snapshot: { epoch: 2 },
        });
    });

    it('can explicitly enter a no-active-principal transition epoch', async () => {
        const coordinator = new StalkerBaseIdentityCoordinator();
        await coordinator.runMutation('principal-a', async () => undefined);

        const transition = await coordinator.runMutation(
            undefined,
            async () => 'transition'
        );

        expect(transition).toEqual({
            snapshot: { epoch: 2 },
            value: 'transition',
        });
    });

    it('installs a principal discovered inside one exclusive mutation without releasing the gate', async () => {
        const coordinator = new StalkerBaseIdentityCoordinator();

        const result = await coordinator.runDiscoveredPrincipalMutation(
            async (epoch) => ({
                principal: 'discovered-principal',
                value: `authenticated-${epoch}`,
            })
        );

        expect(result).toEqual({
            snapshot: {
                activePrincipal: 'discovered-principal',
                epoch: 1,
            },
            value: 'authenticated-1',
        });
    });
});
