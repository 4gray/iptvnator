import assert from 'node:assert/strict';
import test from 'node:test';

import { waitForJourneyQuiet } from './journey-quiet-wait';

interface Activity {
    readonly inFlight: number;
    readonly requests: number;
}

/**
 * Runs the waiter on a fake clock: each poll advances time by `pollMs`, and
 * `script(ms)` says what the app looks like at that time.
 */
async function run(
    script: (atMs: number) => Activity,
    quietMs = 1_000,
    timeoutMs = 30_000
) {
    let clock = 0;
    const polls: number[] = [];
    const result = await waitForJourneyQuiet<Activity>({
        inFlight: (activity) => activity.inFlight,
        now: () => clock,
        pollMs: 100,
        quietMs,
        sample: async () => {
            polls.push(clock);
            return script(clock);
        },
        sleep: async (ms) => {
            clock += ms;
        },
        timeoutError: (activity) =>
            new Error(`not-quiet ${JSON.stringify(activity)}`),
        timeoutMs,
    });
    return { ...result, polls };
}

test('returns once nothing changed for the whole quiet period', async () => {
    const result = await run(() => ({ inFlight: 0, requests: 3 }));
    assert.equal(result.waitedMs, 1_000);
    assert.deepEqual(result.sample, { inFlight: 0, requests: 3 });
});

test('restarts the quiet period at every new request', async () => {
    const result = await run((atMs) => ({
        inFlight: 0,
        requests: atMs < 500 ? 1 : 2,
    }));
    // The second request is first seen at 500 ms.
    assert.equal(result.waitedMs, 1_500);
});

test('counts the quiet period from the poll that saw pending work complete', async () => {
    // One request is in flight until 750 ms; the count never changes. The
    // poll at 800 ms is the first to see it done, so the app is quiet only
    // from 800 ms on, not from the 700 ms poll at which it was pending.
    const result = await run((atMs) => ({
        inFlight: atMs < 750 ? 1 : 0,
        requests: 1,
    }));
    assert.equal(result.waitedMs, 1_800);
});

test('never returns while work stays in flight and fails at the timeout', async () => {
    await assert.rejects(
        run(() => ({ inFlight: 1, requests: 1 }), 1_000, 3_000),
        /not-quiet \{"inFlight":1,"requests":1\}/
    );
});

test('fails when a sample stalls past the deadline instead of accepting it as quiet', async () => {
    let clock = 0;
    let samples = 0;
    await assert.rejects(
        waitForJourneyQuiet<Activity>({
            inFlight: (activity) => activity.inFlight,
            now: () => clock,
            pollMs: 100,
            quietMs: 1_000,
            sample: async () => {
                samples += 1;
                // The second sample hangs for 5 s (e.g. behind a busy main
                // process) and then reports nothing changed.
                if (samples === 2) clock += 5_000;
                return { inFlight: 0, requests: 1 };
            },
            sleep: async (ms) => {
                clock += ms;
            },
            timeoutError: () => new Error('not-quiet-stalled'),
            timeoutMs: 3_000,
        }),
        /not-quiet-stalled/
    );
    assert.equal(samples, 2);
});
