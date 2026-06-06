#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

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
            ...collectCoverageArgs(project, jestRootMode),
        ];
    }

    throw new Error(
        `Tier A project ${project.name} uses unsupported test executor: ${testTarget.executor}`
    );
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

for (const project of tierAProjects) {
    const args = buildNxArgs(project);
    console.log(`\n==> Collecting coverage for ${project.name}`);
    console.log(`pnpm ${args.join(' ')}`);

    const result = spawnSync('pnpm', args, {
        cwd: workspaceRoot,
        env: {
            ...process.env,
            CI: process.env.CI ?? 'true',
            NX_TASKS_RUNNER_DYNAMIC_OUTPUT: 'false',
        },
        stdio: 'inherit',
    });

    if (result.status !== 0) {
        process.exit(result.status ?? 1);
    }
}
