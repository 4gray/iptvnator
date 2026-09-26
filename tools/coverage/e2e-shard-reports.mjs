import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Helpers for reading one or more Playwright JSON reports (`results.json`).
 *
 * The Electron E2E workflow runs the suite as several Playwright shards, one
 * per runner. Each shard writes its own `results.json` that carries
 * `config.shard = { current, total }` and only that shard's tests. A semantic
 * summary is only honest when every shard is present exactly once, so callers
 * verify the set before merging.
 */

export const playwrightReportFileName = 'results.json';

/** Recursively lists every `results.json` below `rootDir`, sorted by path. */
export function findPlaywrightJsonReports(rootDir) {
    if (!existsSync(rootDir) || !statSync(rootDir).isDirectory()) {
        return [];
    }
    const found = [];
    for (const entry of readdirSync(rootDir)) {
        const fullPath = path.join(rootDir, entry);
        if (statSync(fullPath).isDirectory()) {
            found.push(...findPlaywrightJsonReports(fullPath));
        } else if (entry === playwrightReportFileName) {
            found.push(fullPath);
        }
    }
    return found.sort();
}

/**
 * Parses each report and extracts its shard descriptor: `null` when the run
 * was not sharded (`config.shard` absent or `null`). A descriptor that is
 * present but malformed is kept as `malformedShard` so verification rejects
 * it instead of mistaking a partial run for a complete unsharded one.
 */
export function loadPlaywrightReports(reportPaths) {
    return reportPaths.map((reportPath) => {
        const report = JSON.parse(readFileSync(reportPath, 'utf8'));
        const shard = report.config?.shard ?? null;
        const wellFormed =
            shard !== null &&
            Number.isInteger(shard.current) &&
            Number.isInteger(shard.total);
        return {
            path: reportPath,
            report,
            shard: wellFormed ? { current: shard.current, total: shard.total } : null,
            malformedShard: shard !== null && !wellFormed,
        };
    });
}

/**
 * Checks that the loaded reports form exactly one complete run: either a
 * single unsharded report, or every shard `1..total` exactly once.
 */
export function verifyShardReports(reports) {
    const problems = [];
    if (reports.length === 0) {
        problems.push('no Playwright JSON reports were provided');
        return { ok: false, problems };
    }

    const malformed = reports.filter((entry) => entry.malformedShard);
    if (malformed.length > 0) {
        problems.push(`malformed config.shard descriptor: ${describePaths(malformed)}`);
    }

    const unsharded = reports.filter(
        (entry) => entry.shard === null && !entry.malformedShard
    );
    const sharded = reports.filter((entry) => entry.shard !== null);

    if (unsharded.length > 0 && sharded.length > 0) {
        problems.push(
            `mixed sharded and unsharded reports: ${describePaths(unsharded)} carry no shard descriptor`
        );
    }
    if (unsharded.length > 1) {
        problems.push(
            `${unsharded.length} unsharded reports would count every test more than once: ${describePaths(unsharded)}`
        );
    }

    if (sharded.length > 0) {
        const totals = new Set(sharded.map((entry) => entry.shard.total));
        if (totals.size > 1) {
            problems.push(
                `shard totals disagree: ${Array.from(totals).sort().join(', ')}`
            );
        } else {
            const [total] = totals;
            const seen = new Map();
            for (const entry of sharded) {
                const list = seen.get(entry.shard.current) ?? [];
                list.push(entry);
                seen.set(entry.shard.current, list);
            }
            const missing = [];
            for (let index = 1; index <= total; index += 1) {
                if (!seen.has(index)) {
                    missing.push(`${index}/${total}`);
                }
            }
            if (missing.length > 0) {
                problems.push(`missing shards: ${missing.join(', ')}`);
            }
            for (const [current, entries] of seen) {
                if (entries.length > 1) {
                    problems.push(
                        `shard ${current}/${total} appears ${entries.length} times: ${describePaths(entries)}`
                    );
                }
                if (current < 1 || current > total) {
                    problems.push(`shard ${current}/${total} is outside 1..${total}`);
                }
            }
        }
    }

    return { ok: problems.length === 0, problems };
}

/** Human-readable label for the summary, e.g. `3/3 shards (1/3, 2/3, 3/3)`. */
export function describeShardReports(reports) {
    if (reports.length === 0) {
        return 'none';
    }
    const sharded = reports.filter((entry) => entry.shard !== null);
    if (sharded.length === 0) {
        return reports.length === 1
            ? '1 report (unsharded)'
            : `${reports.length} reports (unsharded)`;
    }
    const total = Math.max(...sharded.map((entry) => entry.shard.total));
    const labels = sharded
        .map((entry) => entry.shard)
        .sort((left, right) => left.current - right.current)
        .map((shard) => `${shard.current}/${shard.total}`);
    return `${sharded.length}/${total} shards (${labels.join(', ')})`;
}

function describePaths(entries) {
    return entries.map((entry) => entry.path).join(', ');
}
