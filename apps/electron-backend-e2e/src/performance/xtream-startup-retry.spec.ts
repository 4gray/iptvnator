import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    classifyXtreamStartupFailure,
    runXtreamStartupWithRetry,
} from './xtream-startup-retry';

interface FakeResource {
    readonly id: number;
}

describe('Xtream benchmark startup retry', () => {
    it('relaunches once with a fresh resource after a locked cold database', async () => {
        const created: number[] = [];
        const disposed: number[] = [];
        const result = await runXtreamStartupWithRetry<FakeResource, string>({
            classifyFailure: classifyXtreamStartupFailure,
            create: async (attempt) => {
                if (attempt === 2) {
                    assert.deepEqual(disposed, [1]);
                }
                created.push(attempt);
                return { id: attempt };
            },
            dispose: async ({ id }) => {
                disposed.push(id);
            },
            maxAttempts: 2,
            prepare: async ({ id }) => {
                if (id === 1) {
                    throw new Error(
                        'Error invoking remote method: SqliteError: database is locked'
                    );
                }
                return `ready-${id}`;
            },
        });

        assert.deepEqual(created, [1, 2]);
        assert.deepEqual(disposed, [1]);
        assert.equal(result.attemptCount, 2);
        assert.equal(result.prepared, 'ready-2');
        assert.deepEqual(result.resource, { id: 2 });
        assert.deepEqual(result.retryReasons, ['sqlite-database-locked']);
    });

    it('does not retry an unrelated startup failure', async () => {
        const failure = new Error('renderer preload contract invalid');
        const created: number[] = [];
        const disposed: number[] = [];

        await assert.rejects(
            runXtreamStartupWithRetry<FakeResource, string>({
                classifyFailure: classifyXtreamStartupFailure,
                create: async (attempt) => {
                    created.push(attempt);
                    return { id: attempt };
                },
                dispose: async ({ id }) => {
                    disposed.push(id);
                },
                maxAttempts: 2,
                prepare: async () => {
                    throw failure;
                },
            }),
            (error: unknown) => error === failure
        );
        assert.deepEqual(created, [1]);
        assert.deepEqual(disposed, [1]);
    });

    it('does not create a second app when failed-attempt teardown is unproven', async () => {
        const created: number[] = [];
        const teardownFailure = new Error('electron-process-exit-unconfirmed');

        await assert.rejects(
            runXtreamStartupWithRetry<FakeResource, string>({
                classifyFailure: classifyXtreamStartupFailure,
                create: async (attempt) => {
                    created.push(attempt);
                    return { id: attempt };
                },
                dispose: async () => {
                    throw teardownFailure;
                },
                maxAttempts: 2,
                prepare: async () => {
                    throw new Error('SqliteError: database is locked');
                },
            }),
            (error: unknown) =>
                error instanceof AggregateError &&
                error.errors.includes(teardownFailure)
        );
        assert.deepEqual(created, [1]);
    });

    it('bounds repeated readiness failures and disposes every failed app', async () => {
        const created: number[] = [];
        const disposed: number[] = [];

        await assert.rejects(
            runXtreamStartupWithRetry<FakeResource, string>({
                classifyFailure: classifyXtreamStartupFailure,
                create: async (attempt) => {
                    created.push(attempt);
                    return { id: attempt };
                },
                dispose: async ({ id }) => {
                    disposed.push(id);
                },
                maxAttempts: 2,
                prepare: async ({ id }) => {
                    throw new Error(`no such table on attempt ${id}`);
                },
            }),
            /no such table on attempt 2/
        );
        assert.deepEqual(created, [1, 2]);
        assert.deepEqual(disposed, [1, 2]);
    });

    it('classifies only the known cold-start SQLite readiness failures', () => {
        assert.equal(
            classifyXtreamStartupFailure(
                new Error('SqliteError: database is locked')
            ),
            'sqlite-database-locked'
        );
        assert.equal(
            classifyXtreamStartupFailure(
                new Error('SqliteError: no such table: playlists')
            ),
            'sqlite-schema-not-ready'
        );
        assert.equal(
            classifyXtreamStartupFailure(
                new Error('database disk image malformed')
            ),
            null
        );
    });
});
