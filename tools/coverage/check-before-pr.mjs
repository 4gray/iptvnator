import { execFileSync, execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { sep } from 'node:path';

import {
    compareBaselineDirection,
    DEFAULT_HEAD_PATH,
    formatDirectionResult,
} from '../performance/check-baseline-direction.mjs';
import { checkUnitCoverageScope } from './unit-coverage-scope.mjs';

function git(...args) {
    return execFileSync('git', args, {
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
    });
}

function pnpm(command) {
    execSync(`pnpm ${command}`, {
        env: { ...process.env, CI: 'true' },
        stdio: 'inherit',
    });
}

function checkBaselineDirection(base, head, allowIncrease) {
    const baseBaselines = git('ls-tree', base, '--', DEFAULT_HEAD_PATH)
        ? JSON.parse(git('show', `${base}:${DEFAULT_HEAD_PATH}`))
        : { version: 1, journeys: {} };
    const result = compareBaselineDirection({
        base: baseBaselines,
        head: JSON.parse(git('show', `${head}:${DEFAULT_HEAD_PATH}`)),
        allowIncrease,
    });
    const output = formatDirectionResult(result, 'by local --allow-increase');
    if (result.failures.length > 0) throw new Error(output);
    console.log(output);
}

function uncoveredByFile(lcov) {
    const files = new Map();
    let file;
    for (const record of lcov.split(/\r?\n/)) {
        if (record.startsWith('SF:')) {
            file = { lines: new Set(), branches: new Set() };
            files.set(record.slice(3).split(sep).join('/'), file);
        } else if (record.startsWith('DA:')) {
            const [line, hits] = record.slice(3).split(',');
            if (hits === '0') file.lines.add(Number(line));
        } else if (record.startsWith('BRDA:')) {
            const [line, , , hits] = record.slice(5).split(',');
            if (hits === '0' || hits === '-') file.branches.add(Number(line));
        }
    }
    return files;
}

function reportPatchCoverage(base, head) {
    const report = 'coverage/merged/lcov.info';
    const uncovered = uncoveredByFile(readFileSync(report, 'utf8'));
    const changes = git(
        'diff',
        '--name-status',
        '-z',
        '--find-renames',
        '--diff-filter=AMR',
        base,
        head,
        '--'
    ).split('\0');

    console.log(`\nLocal patch coverage from ${report}`);
    let filesWithGaps = 0;
    for (let index = 0; index < changes.length - 1;) {
        const status = changes[index++];
        const oldPath = changes[index++];
        const file = status.startsWith('R') ? changes[index++] : oldPath;
        const gaps = uncovered.get(file);
        if (!gaps || (gaps.lines.size === 0 && gaps.branches.size === 0))
            continue;

        const diff = git(
            'diff',
            '--unified=0',
            '--no-color',
            '--no-ext-diff',
            '--no-textconv',
            '--find-renames',
            base,
            head,
            '--',
            ...new Set([`:(literal)${oldPath}`, `:(literal)${file}`])
        );
        const ranges = [...diff.matchAll(/^@@ .* \+(\d+)(?:,(\d+))? @@/gm)].map(
            ([, start, count = '1']) => [
                Number(start),
                Number(start) + Number(count),
            ]
        );
        const changed = (line) =>
            ranges.some(([start, end]) => line >= start && line < end);
        const lines = [...gaps.lines].filter(changed).sort((a, b) => a - b);
        const branches = [...gaps.branches]
            .filter(changed)
            .sort((a, b) => a - b);
        if (lines.length === 0 && branches.length === 0) continue;

        filesWithGaps++;
        console.log(
            `  ${file} — uncovered lines: ${lines.join(', ') || 'none'} | uncovered branches: ${branches.join(', ') || 'none'}`
        );
    }
    console.log(
        `Patch coverage gaps in ${filesWithGaps} changed file(s). Codecov computes PR statuses after the CI upload.`
    );
}

try {
    const [target, option, ...extraArgs] = process.argv.slice(2);
    if (
        !target ||
        extraArgs.length > 0 ||
        (option !== undefined && option !== '--allow-increase')
    ) {
        throw new Error(
            'Usage: pnpm run pr:check <PR base ref or SHA> [--allow-increase]'
        );
    }
    if (git('status', '--porcelain', '--untracked-files=normal').length > 0) {
        throw new Error(
            'Run the PR checks in a clean worktree on the commit you intend to review.'
        );
    }

    const head = git('rev-parse', 'HEAD').trim();
    const targetCommit = git(
        'rev-parse',
        '--verify',
        '--end-of-options',
        `${target}^{commit}`
    ).trim();
    const base = git('merge-base', targetCommit, head).trim();
    console.log(`Checking ${head} against PR base ${targetCommit}`);

    checkBaselineDirection(base, head, option === '--allow-increase');
    pnpm('nx build web --skip-nx-cache');
    pnpm('run perf:initial-bytes:check');

    const files = git(
        'diff',
        '--name-only',
        '-z',
        '--no-renames',
        '--ignore-submodules=none',
        base,
        head,
        '--'
    )
        .split('\0')
        .filter(Boolean);
    if ((await checkUnitCoverageScope(files, base)).run) {
        pnpm('run coverage:ci:report');
        reportPatchCoverage(base, head);
        pnpm('run coverage:health --require-report');
    }
} catch (error) {
    console.error(`PR checks failed: ${error.message}`);
    process.exitCode = error.status || 1;
}
