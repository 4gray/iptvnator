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
 *       Validate the policy. Exits non-zero on unclassified projects, stale
 *       entries, or Tier A entries without a test target.
 *   node tools/coverage/check-coverage-policy.mjs --run-non-tier-a
 *       Run the validation command for each Tier B/C project. Uses the
 *       entry's `validationCommand` when present, falling back to
 *       `pnpm nx test <project>`. Projects with an `e2e` target are skipped
 *       because the E2E workflow already runs them on every PR.
 */

import { execFileSync, spawnSync } from 'node:child_process';
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
    const start = output.indexOf('[');
    if (start === -1) {
        throw new Error(
            `nx show projects --json produced no JSON array.\nRaw output:\n${output}`
        );
    }
    return new Set(JSON.parse(output.slice(start)));
}

const testProjects = showProjects(['--withTarget', 'test']);
const allProjects = showProjects();
const e2eProjects = showProjects(['--withTarget', 'e2e']);

function runNonTierA() {
    let failed = false;

    for (const project of [...tiers.tierB, ...tiers.tierC]) {
        if (e2eProjects.has(project.name)) {
            console.log(
                `==> Skipping ${project.name}: covered by the E2E workflow.`
            );
            continue;
        }

        const command =
            project.validationCommand ??
            (testProjects.has(project.name)
                ? `pnpm nx test ${project.name}`
                : null);
        if (!command) {
            console.log(
                `==> Skipping ${project.name}: no validation command or test target.`
            );
            continue;
        }

        console.log(`\n==> Validating ${project.name}: ${command}`);
        const result = spawnSync(command, {
            cwd: workspaceRoot,
            shell: true,
            stdio: 'inherit',
        });
        if (result.status !== 0) {
            failed = true;
        }
    }

    process.exit(failed ? 1 : 0);
}

if (process.argv.includes('--run-non-tier-a')) {
    runNonTierA();
}

const classified = new Map(
    Object.entries(tiers).flatMap(([tier, projects]) =>
        projects.map((project) => [project.name, tier])
    )
);

const unclassified = [...testProjects].filter((name) => !classified.has(name));
const stale = [...classified.keys()].filter((name) => !allProjects.has(name));
const tierAWithoutTest = tiers.tierA
    .map((project) => project.name)
    .filter((name) => !testProjects.has(name));

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
        'Coverage policy lists projects that do not exist in the workspace:\n' +
            stale.map((name) => `  - ${name}`).join('\n') +
            '\n\nRemove them from tools/coverage/coverage-policy.json.'
    );
    process.exit(1);
}

if (tierAWithoutTest.length > 0) {
    console.error(
        'Tier A projects must have a test target, but these do not:\n' +
            tierAWithoutTest.map((name) => `  - ${name}`).join('\n') +
            '\n\nRestore the test target or move the project to Tier B/C in ' +
            'tools/coverage/coverage-policy.json.'
    );
    process.exit(1);
}

console.log(
    `Coverage policy OK: ${testProjects.size} test projects classified ` +
        `(${tiers.tierA.length} Tier A, ${tiers.tierB.length} Tier B, ${tiers.tierC.length} Tier C).`
);
