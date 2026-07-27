import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createReplayRun, type ReplayRun } from './replay-run.js';
import { parseReplayFixtureText } from './replay-schema.js';
import type { ReplayObservedRequest } from './replay.types.js';

const FIXTURE_ROOT = resolve(
    process.cwd(),
    'apps/stalker-mock-server/fixtures/replay'
);

function collectFixturePaths(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true })
        .sort((left, right) => compareCodeUnits(left.name, right.name))
        .flatMap((entry) => {
            const entryPath = join(directory, entry.name);
            if (entry.isDirectory()) {
                return collectFixturePaths(entryPath);
            }
            if (entry.isFile() && entry.name.endsWith('.json')) {
                return [entryPath];
            }
            throw new Error(`Unsafe replay fixture entry: ${entry.name}.`);
        });
}

function emptyGet(path: string): ReplayObservedRequest {
    return {
        origin: 'portal',
        method: 'GET',
        path,
        query: {},
        headers: {},
        cookies: {},
        body: { kind: 'absent' },
    };
}

const FIXTURE_DRIVERS: Readonly<
    Record<string, (run: ReplayRun) => Promise<void>>
> = {
    'resolver-root-landing': async (run) => {
        await run.request(emptyGet('/c/'));
        await run.request(emptyGet('/portal.php'));
    },
};

describe('committed replay fixture corpus', () => {
    it('drives every fixture through exact terminal/cardinality evidence', async () => {
        const fixturePaths = collectFixturePaths(FIXTURE_ROOT);
        expect(fixturePaths.length).toBeGreaterThan(0);

        for (const fixturePath of fixturePaths) {
            const fixture = parseReplayFixtureText(
                readFileSync(fixturePath, 'utf8')
            );
            const driver = FIXTURE_DRIVERS[fixture.scenarioId];
            if (driver === undefined) {
                throw new Error(
                    `Replay fixture driver missing: ${fixture.scenarioId}.`
                );
            }

            const run = createReplayRun(fixture, {
                runId: `fixture-${fixture.scenarioId}`,
            });
            try {
                await driver(run);
                expect({
                    scenarioId: fixture.scenarioId,
                    result: run.finalize(),
                }).toMatchObject({
                    scenarioId: fixture.scenarioId,
                    result: { ok: true },
                });
            } finally {
                run.dispose();
            }
        }
    });
});

function compareCodeUnits(left: string, right: string): number {
    if (left === right) {
        return 0;
    }
    return left < right ? -1 : 1;
}
