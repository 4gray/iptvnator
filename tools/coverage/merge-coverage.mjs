#!/usr/bin/env node

import { createRequire } from 'node:module';
import {
    existsSync,
    mkdirSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const require = createRequire(import.meta.url);
const { createCoverageMap } = require('istanbul-lib-coverage');
const libReport = require('istanbul-lib-report');
const reports = require('istanbul-reports');

const workspaceRoot = process.cwd();
const policy = JSON.parse(
    readFileSync(path.join(workspaceRoot, 'tools/coverage/coverage-policy.json'), 'utf8')
);
const outputDir = path.join(workspaceRoot, policy.reporting.mergedCoverageDir);

const coverageFiles = policy.unitCoverage.tierA
    .map((project) => path.join(workspaceRoot, 'coverage', project.root, 'coverage-final.json'))
    .filter((coverageFile) => existsSync(coverageFile));

if (coverageFiles.length === 0) {
    console.error('No Tier A coverage-final.json files found under coverage/.');
    process.exit(1);
}

rmSync(outputDir, { recursive: true, force: true });
mkdirSync(outputDir, { recursive: true });

const coverageMap = createCoverageMap({});

for (const coverageFile of coverageFiles) {
    const data = JSON.parse(readFileSync(coverageFile, 'utf8'));
    coverageMap.merge(data);
}

const context = libReport.createContext({
    dir: outputDir,
    coverageMap,
});

for (const reporter of ['json', 'json-summary', 'lcovonly', 'cobertura', 'html', 'text-summary']) {
    reports.create(reporter).execute(context);
}

const summary = coverageMap.getCoverageSummary().toJSON();
writeFileSync(
    path.join(outputDir, 'coverage-summary.pretty.json'),
    `${JSON.stringify(summary, null, 4)}\n`
);

console.log(`Merged ${coverageFiles.length} coverage files into ${policy.reporting.mergedCoverageDir}`);
console.log(
    `Statements: ${summary.statements.pct}% | Branches: ${summary.branches.pct}% | Functions: ${summary.functions.pct}% | Lines: ${summary.lines.pct}%`
);
