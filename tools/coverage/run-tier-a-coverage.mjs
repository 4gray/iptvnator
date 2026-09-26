#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import {
    createCoverageOutputScanner,
    validateProjectCoverage,
} from './coverage-integrity.mjs';
import {
    countSpecFiles,
    formatDuration,
    integerEnv,
    integerFlag,
    orderLongestFirst,
    resolveConcurrency,
    resolveWorkersPerProject,
    runWithConcurrency,
} from './coverage-run-pool.mjs';

const workspaceRoot = process.cwd();
const policyPath = path.join(workspaceRoot, 'tools/coverage/coverage-policy.json');
const policy = JSON.parse(readFileSync(policyPath, 'utf8'));
const requestedProjects = new Set(
    process.argv
        .slice(2)
        .flatMap((arg) =>
            arg.startsWith('--projects=')
                ? arg.slice('--projects='.length).split(',')
                : []
        )
        .map((project) => project.trim())
        .filter(Boolean)
);

const tierAProjects = policy.unitCoverage.tierA.filter(
    (project) => requestedProjects.size === 0 || requestedProjects.has(project.name)
);

// Projects run a few at a time (see coverage-run-pool.mjs). Override with
// --concurrency=N / --max-workers=N or TIER_A_CONCURRENCY / TIER_A_MAX_WORKERS
// when a machine has more or less room than the defaults assume.
const cpuCount = os.availableParallelism?.() ?? os.cpus().length;
const concurrency = resolveConcurrency({
    requested:
        integerFlag(process.argv.slice(2), 'concurrency') ??
        integerEnv(process.env, 'TIER_A_CONCURRENCY'),
    cpuCount,
});
const workersPerProject = resolveWorkersPerProject({
    requested:
        integerFlag(process.argv.slice(2), 'max-workers') ??
        integerEnv(process.env, 'TIER_A_MAX_WORKERS'),
    concurrency,
    cpuCount,
});

if (tierAProjects.length === 0) {
    console.error('No Tier A coverage projects matched the requested filters.');
    process.exit(1);
}

function readProjectJson(project) {
    const projectJsonPath = path.join(workspaceRoot, project.root, 'project.json');
    if (!existsSync(projectJsonPath)) {
        throw new Error(`Missing project.json for ${project.name}: ${projectJsonPath}`);
    }

    return JSON.parse(readFileSync(projectJsonPath, 'utf8'));
}

function toPosix(filePath) {
    return filePath.split(path.sep).join('/');
}

function coverageDirFor(project, jestRootMode) {
    const workspaceCoverageDir = path.join('coverage', project.root);
    if (jestRootMode === 'project') {
        return toPosix(path.relative(project.root, workspaceCoverageDir));
    }

    return toPosix(workspaceCoverageDir);
}

function collectCoverageArgs(project, jestRootMode) {
    const sourceGlob =
        jestRootMode === 'project'
            ? 'src/**/*.{ts,js,mjs,html}'
            : `${project.sourceRoot}/**/*.{ts,js,mjs,html}`;
    const sourcePrefix =
        jestRootMode === 'project' ? 'src' : project.sourceRoot;

    return [
        '--coverage',
        `--coverageDirectory=${coverageDirFor(project, jestRootMode)}`,
        `--collectCoverageFrom=${sourceGlob}`,
        `--collectCoverageFrom=!${sourcePrefix}/**/*.{spec,test}.ts`,
        `--collectCoverageFrom=!${sourcePrefix}/**/test-setup.ts`,
        `--collectCoverageFrom=!${sourcePrefix}/**/test-stubs/**`,
        `--collectCoverageFrom=!${sourcePrefix}/**/*.generated.*`,
        `--collectCoverageFrom=!${sourcePrefix}/**/environments/**`,
        `--collectCoverageFrom=!${sourcePrefix}/**/index.ts`,
    ];
}

function jestRootModeFor(project) {
    const mode = project.jestRootMode ?? 'workspace';
    if (mode !== 'workspace' && mode !== 'project') {
        throw new Error(
            `Tier A project ${project.name} has unsupported jestRootMode: ${mode}`
        );
    }

    return mode;
}

function buildNxArgs(project) {
    const projectJson = readProjectJson(project);
    const testTarget = projectJson.targets?.test;
    if (!testTarget) {
        throw new Error(`Tier A project ${project.name} has no test target.`);
    }

    if (testTarget.executor === '@nx/jest:jest') {
        return [
            'nx',
            'run',
            `${project.name}:test`,
            '--configuration=ci',
            '--codeCoverage',
            `--coverageDirectory=${coverageDirFor(project, 'workspace')}`,
            `--maxWorkers=${workersPerProject}`,
            '--output-style=static',
        ];
    }

    if (testTarget.executor === 'nx:run-commands') {
        const jestRootMode = jestRootModeFor(project);

        return [
            'nx',
            'run',
            `${project.name}:test`,
            '--output-style=static',
            '--',
            `--maxWorkers=${workersPerProject}`,
            ...collectCoverageArgs(project, jestRootMode),
        ];
    }

    throw new Error(
        `Tier A project ${project.name} uses unsupported test executor: ${testTarget.executor}`
    );
}

/**
 * Output is buffered per project and written in one piece when the project
 * finishes: with several Jest processes in flight, interleaved lines would be
 * unreadable and the coverage-failure scanner would see other projects' text.
 */
function spawnCoverage(args, scanner, output) {
    return new Promise((resolve, reject) => {
        const child = spawn('pnpm', args, {
            cwd: workspaceRoot,
            env: {
                ...process.env,
                CI: process.env.CI ?? 'true',
                NX_TASKS_RUNNER_DYNAMIC_OUTPUT: 'false',
            },
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        child.stdout.on('data', (chunk) => {
            scanner.push(chunk);
            output.push(chunk);
        });
        child.stderr.on('data', (chunk) => {
            scanner.push(chunk);
            output.push(chunk);
        });
        child.once('error', reject);
        child.once('close', (code, signal) => {
            resolve({ code, signal });
        });
    });
}

async function collectProjectCoverage(project, specCount) {
    const args = buildNxArgs(project);
    const output = [];
    // The start line goes out immediately so a stalled project is visible in
    // the log before the job times out; its full output follows on completion.
    console.log(
        `==> Started ${project.name} (${specCount} spec files): pnpm ${args.join(' ')}`
    );
    const lines = [`\n==> Coverage for ${project.name}`, `pnpm ${args.join(' ')}`];

    const scanner = createCoverageOutputScanner();
    const result = await spawnCoverage(args, scanner, output);
    let failed = result.code !== 0 || result.signal !== null;

    const flush = () => {
        process.stdout.write(`${lines.join('\n')}\n`);
        for (const chunk of output) process.stdout.write(chunk);
        const last = output.at(-1);
        if (last && !last.toString().endsWith('\n')) process.stdout.write('\n');
    };

    if (scanner.collectionFailed) {
        flush();
        console.error(`Coverage collection failed while testing ${project.name}.`);
        return { status: 1 };
    }

    if (failed) {
        flush();
        return { status: result.code && result.code !== 0 ? result.code : 1 };
    }

    const validation = validateProjectCoverage({
        project,
        workspaceRoot,
    });
    flush();
    for (const error of validation.errors) {
        console.error(`Error: ${error}`);
    }

    return { status: validation.errors.length === 0 ? 0 : 1 };
}

for (const project of tierAProjects) {
    const coverageDir = path.join(workspaceRoot, 'coverage', project.root);
    rmSync(coverageDir, { recursive: true, force: true });
}

if (requestedProjects.size === 0) {
    for (const project of [...policy.unitCoverage.tierB, ...policy.unitCoverage.tierC]) {
        if (!project.root) {
            continue;
        }
        const coverageDir = path.join(workspaceRoot, 'coverage', project.root);
        rmSync(coverageDir, { recursive: true, force: true });
    }
}

const specCounts = new Map(
    tierAProjects.map((project) => [
        project.name,
        countSpecFiles(path.join(workspaceRoot, project.sourceRoot)),
    ])
);
const ordered = orderLongestFirst(tierAProjects, (project) =>
    specCounts.get(project.name)
);
console.log(
    `Tier A coverage: ${ordered.length} projects, ${concurrency} in flight, ${workersPerProject} Jest workers each (${cpuCount} cores).`
);
const startedAt = Date.now();
const outcome = await runWithConcurrency(
    ordered.map((project) => ({
        name: project.name,
        run: () =>
            collectProjectCoverage(project, specCounts.get(project.name)),
    })),
    {
        concurrency,
        onSettled: (settled) => {
            console.log(
                `<== ${settled.name} ${settled.status === 0 ? 'ok' : `failed (${settled.status})`} in ${formatDuration(settled.durationMs)}`
            );
            if (settled.error) console.error(settled.error);
        },
    }
);

const longest = [...outcome.results].sort((a, b) => b.durationMs - a.durationMs);
console.log(`\nTier A coverage finished in ${formatDuration(Date.now() - startedAt)} wall-clock; longest projects:`);
for (const entry of longest.slice(0, 8)) {
    console.log(`  ${formatDuration(entry.durationMs).padStart(7)}  ${entry.name}`);
}
if (outcome.skipped.length > 0) {
    console.error(`Not started after the first failure: ${outcome.skipped.join(', ')}`);
}
if (outcome.failed) {
    const first = outcome.results.find((entry) => entry.status !== 0);
    // Set the exit code instead of calling process.exit(): the failing
    // project's buffered output may still be queued on a stdout pipe, and an
    // immediate exit would truncate exactly the log that explains the failure.
    process.exitCode = first?.status && first.status !== 0 ? first.status : 1;
}
