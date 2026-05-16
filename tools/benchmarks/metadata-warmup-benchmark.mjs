#!/usr/bin/env node

const DEFAULTS = {
    items: 250,
    latencyMs: 40,
    jitterMs: 20,
    concurrency: [1, 2, 4, 6, 8],
};

function readArg(name, fallback) {
    const prefix = `--${name}=`;
    const value = process.argv.find((arg) => arg.startsWith(prefix));
    return value ? value.slice(prefix.length) : fallback;
}

function readNumber(name, fallback) {
    const value = Number(readArg(name, fallback));
    return Number.isFinite(value) ? value : fallback;
}

function readConcurrency() {
    const raw = readArg('concurrency', DEFAULTS.concurrency.join(','));
    return raw
        .split(',')
        .map((value) => Number(value.trim()))
        .filter((value) => Number.isFinite(value) && value > 0)
        .map((value) => Math.floor(value));
}

function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function sampleLatency(latencyMs, jitterMs) {
    if (jitterMs <= 0) {
        return latencyMs;
    }

    return Math.max(0, latencyMs + (Math.random() * 2 - 1) * jitterMs);
}

async function runSyntheticWarmup({ items, latencyMs, jitterMs, concurrency }) {
    let nextItem = 0;
    let completed = 0;
    const startedAt = performance.now();
    const probeDurations = [];

    async function worker() {
        while (nextItem < items) {
            nextItem++;
            const probeStartedAt = performance.now();
            await wait(sampleLatency(latencyMs, jitterMs));
            probeDurations.push(performance.now() - probeStartedAt);
            completed++;
        }
    }

    await Promise.all(
        Array.from({ length: Math.min(concurrency, items) }, () => worker())
    );

    const durationMs = performance.now() - startedAt;
    const averageProbeMs =
        probeDurations.reduce((sum, value) => sum + value, 0) /
        Math.max(1, probeDurations.length);

    return {
        concurrency,
        items: completed,
        durationMs: Math.round(durationMs),
        averageProbeMs: Math.round(averageProbeMs),
        itemsPerSecond: Math.round((completed / durationMs) * 10000) / 10,
        estimatedItemsPerMinute:
            Math.round((completed / durationMs) * 600000) / 10,
    };
}

async function main() {
    const items = readNumber('items', DEFAULTS.items);
    const latencyMs = readNumber('latency-ms', DEFAULTS.latencyMs);
    const jitterMs = readNumber('jitter-ms', DEFAULTS.jitterMs);
    const concurrencyValues = readConcurrency();

    const results = [];
    for (const concurrency of concurrencyValues) {
        results.push(
            await runSyntheticWarmup({
                items,
                latencyMs,
                jitterMs,
                concurrency,
            })
        );
    }

    console.table(results);
    console.log(
        JSON.stringify(
            {
                input: { items, latencyMs, jitterMs, concurrencyValues },
                results,
            },
            null,
            2
        )
    );
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
