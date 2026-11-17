import { openDatabaseAtStartup } from './database-startup';

function setup(outcomes: readonly ('fail' | 'ok')[]) {
    const order: string[] = [];
    let call = 0;
    const deps = {
        initDatabase: jest.fn(async () => {
            const outcome = outcomes[Math.min(call++, outcomes.length - 1)];
            order.push(`init:${outcome}`);
            if (outcome === 'fail') {
                throw Object.assign(new Error('unable to open database file'), {
                    code: 'SQLITE_CANTOPEN',
                });
            }
        }),
        recoveryPasses: [
            jest.fn(async () => {
                order.push('reset-downloads');
            }),
            jest.fn(async () => {
                order.push('reconcile-recordings');
            }),
        ],
        reportFailure: jest.fn((error: unknown) => {
            order.push(`report:${(error as Error).message}`);
        }),
        trace: jest.fn((phase: string) => order.push(`trace:${phase}`)),
        retryDelaysMs: [10, 20],
        wait: jest.fn(async (ms: number) => {
            order.push(`wait:${ms}`);
        }),
    };
    return { deps, order };
}

describe('openDatabaseAtStartup', () => {
    it('runs the recovery passes once the database opens', async () => {
        const { deps, order } = setup(['ok']);

        await expect(openDatabaseAtStartup(deps)).resolves.toBe(true);

        expect(order).toEqual([
            'init:ok',
            'trace:init-database:done',
            'reset-downloads',
            'reconcile-recordings',
        ]);
        expect(deps.reportFailure).not.toHaveBeenCalled();
    });

    it('retries a failed open and recovers after the attempt that succeeds', async () => {
        const { deps, order } = setup(['fail', 'ok']);

        await expect(openDatabaseAtStartup(deps)).resolves.toBe(true);

        expect(order).toEqual([
            'init:fail',
            'trace:init-database:retry',
            'wait:10',
            'init:ok',
            'trace:init-database:done',
            'reset-downloads',
            'reconcile-recordings',
        ]);
        expect(deps.reportFailure).not.toHaveBeenCalled();
    });

    it('reports the last failure once and skips the passes when every attempt fails', async () => {
        const { deps, order } = setup(['fail']);

        await expect(openDatabaseAtStartup(deps)).resolves.toBe(false);

        expect(deps.initDatabase).toHaveBeenCalledTimes(3);
        expect(deps.reportFailure).toHaveBeenCalledTimes(1);
        expect(order.slice(-2)).toEqual([
            'trace:init-database:failed',
            'report:unable to open database file',
        ]);
        for (const pass of deps.recoveryPasses) {
            expect(pass).not.toHaveBeenCalled();
        }
    });

    it('keeps running the remaining passes when one throws', async () => {
        const { deps, order } = setup(['ok']);
        const consoleError = jest
            .spyOn(console, 'error')
            .mockImplementation(() => undefined);
        deps.recoveryPasses[0].mockRejectedValueOnce(
            new Error('synthetic pass failure')
        );

        await expect(openDatabaseAtStartup(deps)).resolves.toBe(true);

        expect(order).toContain('reconcile-recordings');
        expect(consoleError).toHaveBeenCalledWith(
            'Startup recovery pass failed:',
            'synthetic pass failure'
        );
        consoleError.mockRestore();
    });
});
