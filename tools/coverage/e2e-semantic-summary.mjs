#!/usr/bin/env node

import {
    existsSync,
    mkdirSync,
    readFileSync,
    readdirSync,
    statSync,
    writeFileSync,
} from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const workspaceRoot = process.cwd();
const args = process.argv.slice(2);
const projectArg = valueFor('--project');
const inputArg = valueFor('--input');
const policy = JSON.parse(
    readFileSync(path.join(workspaceRoot, 'tools/coverage/coverage-policy.json'), 'utf8')
);
const outputDir = path.join(workspaceRoot, policy.reporting.e2eSummaryDir);

function valueFor(flag) {
    const prefixed = args.find((arg) => arg.startsWith(`${flag}=`));
    if (prefixed) {
        return prefixed.slice(flag.length + 1);
    }
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : undefined;
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

function normalizeTag(tag) {
    const normalized = tag.startsWith('@') ? tag : `@${tag}`;
    return normalized.toLowerCase();
}

function tagsFromTitle(title) {
    return Array.from(
        new Set((title.match(/@[a-z0-9-]+/gi) ?? []).map(normalizeTag).sort())
    );
}

function collectFromPlaywrightJson(filePath, projectName) {
    const report = JSON.parse(readFileSync(filePath, 'utf8'));
    const tests = [];

    function walkSuite(suite, inheritedFile) {
        const file = suite.file ?? inheritedFile;
        for (const spec of suite.specs ?? []) {
            const title = [...(spec.titlePath ?? []), spec.title].filter(Boolean).join(' ');
            const tags = new Set([
                ...(spec.tags ?? []).map(normalizeTag),
                ...tagsFromTitle(title),
            ]);
            const statuses = (spec.tests ?? []).flatMap((test) =>
                (test.results ?? []).map((result) => result.status)
            );
            const status = statuses.includes('failed')
                ? 'failed'
                : statuses.includes('timedOut')
                  ? 'failed'
                  : statuses.includes('skipped')
                    ? 'skipped'
                    : statuses.length > 1 && statuses.includes('passed')
                      ? 'flaky'
                      : statuses[0] ?? 'unknown';

            tests.push({
                project: projectName,
                file,
                title,
                status,
                tags: Array.from(tags).sort(),
            });
        }

        for (const child of suite.suites ?? []) {
            walkSuite(child, file);
        }
    }

    for (const suite of report.suites ?? []) {
        walkSuite(suite, suite.file);
    }

    return tests;
}

function collectFromSource(projectName) {
    const root =
        projectName === 'electron-backend-e2e'
            ? 'apps/electron-backend-e2e/src'
            : 'apps/web-e2e/src';
    const files = listFiles(path.join(workspaceRoot, root), (file) => file.endsWith('.e2e.ts'));
    const tests = [];

    for (const file of files) {
        const relativeFile = path.relative(workspaceRoot, file);
        const contents = readFileSync(file, 'utf8');
        const regex = /\btest(?:\.describe)?\s*\(\s*(['"`])([\s\S]*?)\1/g;
        for (const match of contents.matchAll(regex)) {
            const title = match[2].replace(/\s+/g, ' ').trim();
            const tags = tagsFromTitle(title);
            if (tags.length > 0) {
                tests.push({
                    project: projectName,
                    file: relativeFile,
                    title,
                    status: 'not-run',
                    tags,
                });
            }
        }
    }

    return tests;
}

function defaultInputFor(projectName) {
    return path.join(workspaceRoot, 'dist/test-results', projectName, 'results.json');
}

function collectTests(projectName) {
    const inputPath = inputArg
        ? path.resolve(workspaceRoot, inputArg)
        : defaultInputFor(projectName);

    if (existsSync(inputPath)) {
        return collectFromPlaywrightJson(inputPath, projectName);
    }

    return collectFromSource(projectName);
}

function statusCounts(tests) {
    return tests.reduce((counts, test) => {
        counts[test.status] = (counts[test.status] ?? 0) + 1;
        return counts;
    }, {});
}

function tagCounts(tests) {
    const counts = {};
    for (const test of tests) {
        for (const tag of test.tags) {
            counts[tag] = (counts[tag] ?? 0) + 1;
        }
    }
    return counts;
}

function journeyMatches(journey, tests) {
    return tests.filter(
        (test) =>
            journey.projects.includes(test.project) &&
            journey.matchAnyTags.some((tag) => test.tags.includes(tag))
    );
}

function markdownFor(projectName, tests) {
    const counts = statusCounts(tests);
    const countsText = Object.entries(counts)
        .map(([status, count]) => `${status}: ${count}`)
        .join(', ');
    const tagRows = Object.entries(tagCounts(tests))
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([tag, count]) => `| ${tag} | ${count} |`)
        .join('\n');
    const journeys = policy.e2eSemanticCoverage.criticalJourneys
        .filter((journey) => !projectName || journey.projects.includes(projectName))
        .map((journey) => {
            const matches = journeyMatches(journey, tests);
            const failed = matches.some((test) => test.status === 'failed');
            const status = matches.length === 0 ? 'missing' : failed ? 'failing' : 'covered';
            return `| ${journey.name} | ${journey.matchAnyTags.join(', ')} | ${matches.length} | ${status} |`;
        })
        .join('\n');

    return `# E2E Semantic Coverage${projectName ? `: ${projectName}` : ''}

Source: ${tests.some((test) => test.status === 'not-run') ? 'spec source scan' : 'Playwright JSON report'}

Total tracked tests: ${tests.length}

Statuses: ${countsText || 'none'}

## Tags

| Tag | Tests |
| --- | ---: |
${tagRows || '| _none_ | 0 |'}

## Critical Journeys

| Journey | Matching tags | Tests | Status |
| --- | --- | ---: | --- |
${journeys || '| _none_ | _n/a_ | 0 | missing |'}
`;
}

const projects = projectArg ? [projectArg] : ['web-e2e', 'electron-backend-e2e'];
const allTests = projects.flatMap((projectName) => collectTests(projectName));

mkdirSync(outputDir, { recursive: true });

if (projectArg) {
    const content = markdownFor(projectArg, allTests);
    writeFileSync(path.join(outputDir, `${projectArg}-semantic-summary.md`), content);
    writeFileSync(
        path.join(outputDir, `${projectArg}-semantic-summary.json`),
        `${JSON.stringify(allTests, null, 4)}\n`
    );
    if (process.env.GITHUB_STEP_SUMMARY) {
        writeFileSync(process.env.GITHUB_STEP_SUMMARY, `\n${content}\n`, { flag: 'a' });
    }
    console.log(`Wrote ${policy.reporting.e2eSummaryDir}/${projectArg}-semantic-summary.md`);
} else {
    const content = markdownFor(undefined, allTests);
    writeFileSync(path.join(outputDir, 'semantic-summary.md'), content);
    writeFileSync(
        path.join(outputDir, 'semantic-summary.json'),
        `${JSON.stringify(allTests, null, 4)}\n`
    );
    if (process.env.GITHUB_STEP_SUMMARY) {
        writeFileSync(process.env.GITHUB_STEP_SUMMARY, `\n${content}\n`, { flag: 'a' });
    }
    console.log(`Wrote ${policy.reporting.e2eSummaryDir}/semantic-summary.md`);
}
