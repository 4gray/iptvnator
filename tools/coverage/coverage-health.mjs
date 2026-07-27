#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import {
    existsSync,
    readFileSync,
    readdirSync,
    statSync,
} from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import {
    evaluateCoverageRatchets,
    validateMergedCoverage,
    validateProjectCoverage,
    validateRequiredProjectReports,
} from './coverage-integrity.mjs';

const COVERAGE_METRICS = [
    'statements',
    'branches',
    'functions',
    'lines',
];
const COVERAGE_SUMMARY_FIELDS = ['covered', 'total', 'pct'];

const workspaceRoot = process.cwd();
const args = new Set(process.argv.slice(2));
const requireReport = args.has('--require-report');
const policy = JSON.parse(
    readFileSync(path.join(workspaceRoot, 'tools/coverage/coverage-policy.json'), 'utf8')
);

const warnings = [];
const errors = [];

function warn(message) {
    warnings.push(message);
    if (process.env.GITHUB_ACTIONS) {
        console.log(`::warning::${message}`);
    } else {
        console.warn(`Warning: ${message}`);
    }
}

function readJson(filePath) {
    return JSON.parse(readFileSync(filePath, 'utf8'));
}

function projectJsonPath(project) {
    return path.join(workspaceRoot, project.root, 'project.json');
}

function projectCoveragePath(project) {
    return path.join(
        workspaceRoot,
        'coverage',
        project.root,
        'coverage-final.json'
    );
}

function verifyTierAProjects() {
    for (const project of policy.unitCoverage.tierA) {
        const filePath = projectJsonPath(project);
        if (!existsSync(filePath)) {
            errors.push(`Tier A project ${project.name} is missing ${project.root}/project.json.`);
            continue;
        }

        const projectJson = readJson(filePath);
        if (!projectJson.targets?.test) {
            errors.push(`Tier A project ${project.name} must have a test target.`);
        }
        if (!project.sourceRoot || !existsSync(path.join(workspaceRoot, project.sourceRoot))) {
            errors.push(`Tier A project ${project.name} has an invalid sourceRoot: ${project.sourceRoot}`);
        }
        if (project.sourceRoot && !hasSpecUnder(project.sourceRoot)) {
            errors.push(`Tier A project ${project.name} has no unit specs under ${project.sourceRoot}. Move it to Tier B/C or add focused tests.`);
        }
    }
}

function verifyProjectCoverageReports() {
    if (requireReport) {
        const validation = validateRequiredProjectReports({
            projects: policy.unitCoverage.tierA,
            workspaceRoot,
        });
        errors.push(...validation.errors);
        return;
    }

    for (const project of policy.unitCoverage.tierA) {
        if (!existsSync(projectCoveragePath(project))) {
            continue;
        }

        const validation = validateProjectCoverage({
            project,
            workspaceRoot,
        });
        errors.push(...validation.errors);
    }
}

function reportCoverageSummaryMismatches(reportedSummary, computedSummary) {
    for (const metric of COVERAGE_METRICS) {
        const reported = reportedSummary[metric];
        const computed = computedSummary[metric];
        if (
            COVERAGE_SUMMARY_FIELDS.every(
                (field) => reported?.[field] === computed?.[field]
            )
        ) {
            continue;
        }

        errors.push(
            `Merged coverage summary mismatch for ${metric}: coverage-summary.json reports covered ${reported?.covered}, total ${reported?.total}, pct ${reported?.pct}; coverage-final.json computes covered ${computed?.covered}, total ${computed?.total}, pct ${computed?.pct}.`
        );
    }
}

function verifyCoverageReport() {
    const summaryPath = path.join(
        workspaceRoot,
        policy.reporting.mergedCoverageDir,
        'coverage-summary.json'
    );
    const ratchet = policy.reporting.coverageRatchet;
    const coveragePath = path.join(
        workspaceRoot,
        policy.reporting.mergedCoverageDir,
        'coverage-final.json'
    );
    const summaryExists = existsSync(summaryPath);
    const coverageExists = existsSync(coveragePath);

    if (!summaryExists && !coverageExists) {
        const message = `Merged coverage summary not found at ${path.relative(workspaceRoot, summaryPath)}.`;
        if (requireReport) {
            errors.push(message);
        } else {
            warn(message);
        }
        return;
    }

    if (summaryExists !== coverageExists) {
        const existingPath = summaryExists ? summaryPath : coveragePath;
        const missingPath = summaryExists ? coveragePath : summaryPath;
        errors.push(
            `Merged coverage artifacts are incomplete: found ${path.relative(workspaceRoot, existingPath)} but ${path.relative(workspaceRoot, missingPath)} is missing.`
        );
        return;
    }

    let summaryDocument;
    try {
        summaryDocument = readJson(summaryPath);
    } catch (error) {
        errors.push(
            `Merged coverage summary ${path.relative(workspaceRoot, summaryPath)} contains invalid JSON: ${error.message}`
        );
        return;
    }

    const summary = summaryDocument?.total;
    if (
        !summary ||
        COVERAGE_METRICS.some(
            (metric) =>
                !summary[metric] ||
                !Number.isFinite(summary[metric].pct)
        )
    ) {
        errors.push(
            `Merged coverage summary ${path.relative(workspaceRoot, summaryPath)} does not contain usable total coverage metrics.`
        );
        return;
    }

    let coverageData;
    try {
        coverageData = readJson(coveragePath);
    } catch (error) {
        errors.push(
            `Merged coverage report ${path.relative(workspaceRoot, coveragePath)} contains invalid JSON: ${error.message}`
        );
        return;
    }

    const mergedValidation = validateMergedCoverage({
        coverageData,
        projects: policy.unitCoverage.tierA,
        reportPath: coveragePath,
        workspaceRoot,
    });
    errors.push(...mergedValidation.errors);
    if (!mergedValidation.coverageMap) {
        return;
    }
    const computedSummary = mergedValidation.coverageMap
        .getCoverageSummary()
        .toJSON();

    console.log(
        `Merged coverage: statements ${computedSummary.statements.pct}%, branches ${computedSummary.branches.pct}%, functions ${computedSummary.functions.pct}%, lines ${computedSummary.lines.pct}%.`
    );
    reportCoverageSummaryMismatches(summary, computedSummary);

    if (mergedValidation.errors.length > 0 || ratchet === undefined) {
        return;
    }

    try {
        errors.push(
            ...evaluateCoverageRatchets({
                coverageData,
                mergedSummary: computedSummary,
                ratchet,
                workspaceRoot,
            })
        );
    } catch (error) {
        errors.push(
            `Merged coverage report ${path.relative(workspaceRoot, coveragePath)} is not valid Istanbul coverage: ${error.message}`
        );
    }
}

function listFiles(directory, predicate) {
    if (!existsSync(directory)) {
        return [];
    }

    const files = [];
    for (const entry of readdirSync(directory)) {
        const fullPath = path.join(directory, entry);
        const stats = statSync(fullPath);
        if (stats.isDirectory()) {
            files.push(...listFiles(fullPath, predicate));
        } else if (predicate(fullPath)) {
            files.push(fullPath);
        }
    }
    return files;
}

function hasSpecUnder(sourceRoot) {
    return listFiles(path.join(workspaceRoot, sourceRoot), (file) =>
        /\.(spec|test)\.ts$/.test(file)
    ).length > 0;
}

function scanE2ETags() {
    const e2eFiles = [
        ...listFiles(path.join(workspaceRoot, 'apps/web-e2e/src'), (file) => file.endsWith('.e2e.ts')),
        ...listFiles(path.join(workspaceRoot, 'apps/electron-backend-e2e/src'), (file) =>
            file.endsWith('.e2e.ts')
        ),
    ];
    const tags = new Set();

    for (const file of e2eFiles) {
        const contents = readFileSync(file, 'utf8');
        for (const match of contents.matchAll(/@[a-z0-9-]+/gi)) {
            tags.add(match[0]);
        }
    }

    for (const tag of policy.e2eSemanticCoverage.trackedTags) {
        if (!tags.has(tag)) {
            warn(`Tracked E2E tag ${tag} is not present in current Playwright specs yet.`);
        }
    }
}

function changedFiles() {
    const changedFileSet = new Set();
    const commands = [];
    if (process.env.GITHUB_BASE_REF) {
        commands.push(['git', ['diff', '--name-only', `origin/${process.env.GITHUB_BASE_REF}...HEAD`]]);
    } else {
        commands.push(['git', ['diff', '--name-only', 'HEAD']]);
        commands.push(['git', ['ls-files', '--others', '--exclude-standard']]);
        commands.push(['git', ['diff', '--name-only', 'HEAD~1...HEAD']]);
    }

    for (const [command, commandArgs] of commands) {
        try {
            const output = execFileSync(command, commandArgs, {
                cwd: workspaceRoot,
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'ignore'],
            });
            const outputFiles = output
                .split('\n')
                .map((file) => file.trim())
                .filter(Boolean);
            for (const file of outputFiles) {
                changedFileSet.add(file);
            }
        } catch {
            // Try the next diff source.
        }
    }

    return Array.from(changedFileSet);
}

function sourceOwner(file) {
    return policy.unitCoverage.tierA.find((project) =>
        file.startsWith(`${project.sourceRoot}/`)
    );
}

function hasNearbySpec(file) {
    const parsed = path.parse(file);
    const candidateNames = [
        path.join(parsed.dir, `${parsed.name}.spec.ts`),
        path.join(parsed.dir, `${parsed.name}.test.ts`),
    ];

    return candidateNames.some((candidate) => existsSync(path.join(workspaceRoot, candidate)));
}

function reportChangedCriticalFiles() {
    const files = changedFiles().filter(
        (file) =>
            /\.(ts|html)$/.test(file) &&
            !/\.(spec|test)\.ts$/.test(file) &&
            !file.endsWith('test-setup.ts')
    );

    for (const file of files) {
        const owner = sourceOwner(file);
        if (!owner) {
            continue;
        }

        if (!hasNearbySpec(file)) {
            warn(
                `${file} is Tier A source without a same-name unit spec. Preferred validation: ${owner.validationCommand}; related E2E tags: ${owner.e2eTags.join(', ')}.`
            );
        }
    }
}

verifyTierAProjects();
verifyProjectCoverageReports();
verifyCoverageReport();
scanE2ETags();
reportChangedCriticalFiles();

if (errors.length > 0) {
    for (const error of errors) {
        console.error(`Error: ${error}`);
    }
    process.exit(1);
}

console.log(
    warnings.length === 0
        ? 'Coverage health checks passed.'
        : `Coverage health completed with ${warnings.length} warning(s).`
);
