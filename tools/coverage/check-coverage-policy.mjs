#!/usr/bin/env node

/**
 * Guards tools/coverage/coverage-policy.json against drift.
 *
 * Every Nx project with a `test` target must be classified in a coverage
 * tier (A, B, or C). This makes CI fail loudly when a new library is added
 * without deciding how it is tested, instead of silently skipping it.
 *
 * Usage:
 *   node tools/coverage/check-coverage-policy.mjs
 *       Validate the policy. Exits non-zero on unclassified or stale entries.
 *   node tools/coverage/check-coverage-policy.mjs --list-non-tier-a
 *       Print a comma-separated list of Tier B/C projects that have a test
 *       target, for running them in CI without coverage.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const workspaceRoot = process.cwd();
const policyPath = path.join(workspaceRoot, 'tools/coverage/coverage-policy.json');
const policy = JSON.parse(readFileSync(policyPath, 'utf8'));

const tiers = {
    tierA: policy.unitCoverage.tierA ?? [],
    tierB: policy.unitCoverage.tierB ?? [],
    tierC: policy.unitCoverage.tierC ?? [],
};

function showProjects(extraArgs = []) {
    const output = execFileSync(
        'pnpm',
        ['nx', 'show', 'projects', '--json', ...extraArgs],
        { cwd: workspaceRoot, encoding: 'utf8' }
    );
    return new Set(JSON.parse(output.slice(output.indexOf('['))));
}

const testProjects = showProjects(['--withTarget', 'test']);
const allProjects = showProjects();

const classified = new Map(
    Object.entries(tiers).flatMap(([tier, projects]) =>
        projects.map((project) => [project.name, tier])
    )
);

if (process.argv.includes('--list-non-tier-a')) {
    const nonTierA = [...tiers.tierB, ...tiers.tierC]
        .map((project) => project.name)
        .filter((name) => testProjects.has(name));
    process.stdout.write(nonTierA.join(','));
    process.exit(0);
}

const unclassified = [...testProjects].filter((name) => !classified.has(name));
const stale = [...classified.keys()].filter((name) => !allProjects.has(name));

if (unclassified.length > 0) {
    console.error(
        'Coverage policy is missing projects that have a test target:\n' +
            unclassified.map((name) => `  - ${name}`).join('\n') +
            '\n\nAdd each project to a tier in tools/coverage/coverage-policy.json:' +
            '\n  tierA: runs in CI with coverage (Codecov)' +
            '\n  tierB/tierC: runs in CI without coverage'
    );
    process.exit(1);
}

if (stale.length > 0) {
    console.error(
        'Coverage policy lists projects that no longer have a test target:\n' +
            stale.map((name) => `  - ${name}`).join('\n') +
            '\n\nRemove them from tools/coverage/coverage-policy.json.'
    );
    process.exit(1);
}

console.log(
    `Coverage policy OK: ${testProjects.size} test projects classified ` +
        `(${tiers.tierA.length} Tier A, ${tiers.tierB.length} Tier B, ${tiers.tierC.length} Tier C).`
);
