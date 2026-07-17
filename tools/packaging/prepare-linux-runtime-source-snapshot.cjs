#!/usr/bin/env node

'use strict';

const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');

const GIT_COMMIT_PATTERN = /^[a-f0-9]{40,64}$/;

function gitOutput(checkoutPath, ...args) {
    try {
        return childProcess
            .execFileSync('git', ['-C', checkoutPath, ...args], {
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'pipe'],
            })
            .trim();
    } catch (error) {
        const stderr =
            error && typeof error === 'object' && 'stderr' in error
                ? String(error.stderr).trim()
                : '';
        throw new Error(
            `Unable to inspect source checkout with git ${args.join(' ')}${stderr ? `: ${stderr}` : '.'}`
        );
    }
}

function assertExpectedGitRecord(expected) {
    if (
        expected === null ||
        typeof expected !== 'object' ||
        typeof expected.sourceGitCommit !== 'string' ||
        !GIT_COMMIT_PATTERN.test(expected.sourceGitCommit) ||
        !Array.isArray(expected.sourceSubmodules) ||
        expected.sourceSubmodules.some(
            (record) => typeof record !== 'string' || record.length === 0
        )
    ) {
        throw new Error(
            'Expected source identity must contain one commit and a submodule record array.'
        );
    }
}

function assertCleanCheckout(checkoutPath, label) {
    const status = gitOutput(
        checkoutPath,
        'status',
        '--porcelain=v1',
        '--untracked-files=all',
        '--ignore-submodules=none'
    );
    if (status) {
        throw new Error(`${label} checkout contains dirty or untracked files.`);
    }
}

function sourceSubmoduleIdentity(record) {
    const match = record.match(/^([a-f0-9]{40,64})\s+([^\s]+)(?:\s|$)/);
    if (!match) {
        throw new Error(`Invalid source submodule record: ${record}`);
    }
    const submodulePath = match[2];
    if (
        path.isAbsolute(submodulePath) ||
        submodulePath
            .split('/')
            .some((part) => part === '' || part === '.' || part === '..')
    ) {
        throw new Error(`Unsafe source submodule path: ${submodulePath}`);
    }
    return {
        commit: match[1],
        path: submodulePath,
    };
}

function inspectCleanGitSource(checkoutPath, expected) {
    assertExpectedGitRecord(expected);
    const sourceGitCommit = gitOutput(checkoutPath, 'rev-parse', 'HEAD');
    if (sourceGitCommit !== expected.sourceGitCommit) {
        throw new Error(
            'Source checkout commit does not match the runtime manifest.'
        );
    }
    const submoduleOutput = gitOutput(
        checkoutPath,
        'submodule',
        'status',
        '--recursive'
    );
    const sourceSubmodules = submoduleOutput
        ? submoduleOutput
              .split(/\r?\n/)
              .map((line) => line.trim())
              .filter(Boolean)
        : [];
    if (!isDeepStrictEqual(sourceSubmodules, expected.sourceSubmodules)) {
        throw new Error(
            'Source checkout submodules do not match the runtime manifest.'
        );
    }

    assertCleanCheckout(checkoutPath, 'Source');
    for (const submoduleRecord of sourceSubmodules) {
        const submodule = sourceSubmoduleIdentity(submoduleRecord);
        const submoduleCheckout = path.join(
            checkoutPath,
            ...submodule.path.split('/')
        );
        if (
            gitOutput(submoduleCheckout, 'rev-parse', 'HEAD') !==
            submodule.commit
        ) {
            throw new Error(
                `Source submodule ${submodule.path} commit does not match its recorded identity.`
            );
        }
        assertCleanCheckout(
            submoduleCheckout,
            `Source submodule ${submodule.path}`
        );
    }
    return {
        sourceGitCommit,
        sourceSubmodules,
    };
}

function gitMetadataEntries(rootPath) {
    const entries = [];
    function visit(directoryPath, relativeDirectory = '') {
        for (const entry of fs.readdirSync(directoryPath, {
            withFileTypes: true,
        })) {
            const relativePath = path.posix.join(relativeDirectory, entry.name);
            const absolutePath = path.join(directoryPath, entry.name);
            if (entry.name === '.git') {
                entries.push(relativePath);
            } else if (entry.isDirectory()) {
                visit(absolutePath, relativePath);
            }
        }
    }
    visit(rootPath);
    return entries.sort();
}

function assertNoGitMetadata(rootPath) {
    const entries = gitMetadataEntries(rootPath);
    if (entries.length > 0) {
        throw new Error(
            `Prepared source snapshot must not contain VCS metadata: ${entries.join(', ')}`
        );
    }
}

function lstatIfExists(candidatePath) {
    try {
        return fs.lstatSync(candidatePath);
    } catch (error) {
        if (
            error &&
            typeof error === 'object' &&
            'code' in error &&
            error.code === 'ENOENT'
        ) {
            return null;
        }
        throw error;
    }
}

function copyWorkingTreeWithoutGitMetadata(checkoutPath, outputPath) {
    const outputParent = path.dirname(outputPath);
    const temporaryPath = fs.mkdtempSync(
        path.join(outputParent, `.${path.basename(outputPath)}-`)
    );
    try {
        fs.cpSync(checkoutPath, temporaryPath, {
            recursive: true,
            dereference: false,
            verbatimSymlinks: true,
            filter: (sourcePath) => path.basename(sourcePath) !== '.git',
        });
        assertNoGitMetadata(temporaryPath);
        if (lstatIfExists(outputPath)) {
            throw new Error(
                `Prepared source snapshot output must not already exist: ${outputPath}`
            );
        }
        fs.renameSync(temporaryPath, outputPath);
    } catch (error) {
        fs.rmSync(temporaryPath, { recursive: true, force: true });
        throw error;
    }
}

function prepareLinuxRuntimeSourceSnapshot({
    checkoutPath,
    outputPath,
    expected,
}) {
    const checkoutStat = fs.lstatSync(checkoutPath);
    if (!checkoutStat.isDirectory() || checkoutStat.isSymbolicLink()) {
        throw new Error('Source checkout must be a real directory.');
    }
    const checkoutRoot = fs.realpathSync(checkoutPath);
    const outputRoot = path.resolve(outputPath);
    const outputParent = path.dirname(outputRoot);
    const outputParentStat = fs.lstatSync(outputParent);
    if (!outputParentStat.isDirectory() || outputParentStat.isSymbolicLink()) {
        throw new Error(
            'Prepared source snapshot parent must be a real directory.'
        );
    }
    if (lstatIfExists(outputRoot)) {
        throw new Error(
            `Prepared source snapshot output must not already exist: ${outputRoot}`
        );
    }
    const realOutputRoot = path.join(
        fs.realpathSync(outputParent),
        path.basename(outputRoot)
    );
    const isInside = (root, candidate) => {
        const relative = path.relative(root, candidate);
        return (
            relative === '' ||
            (relative !== '..' &&
                !relative.startsWith(`..${path.sep}`) &&
                !path.isAbsolute(relative))
        );
    };
    if (
        isInside(checkoutRoot, realOutputRoot) ||
        isInside(realOutputRoot, checkoutRoot)
    ) {
        throw new Error(
            'Prepared source snapshot and checkout must be separate trees.'
        );
    }
    const record = inspectCleanGitSource(checkoutRoot, expected);
    copyWorkingTreeWithoutGitMetadata(checkoutRoot, realOutputRoot);
    assertNoGitMetadata(realOutputRoot);
    return record;
}

function parseArguments(argv) {
    const [command, ...tokens] = argv;
    const options = {};
    for (let index = 0; index < tokens.length; index += 2) {
        const name = tokens[index];
        const value = tokens[index + 1];
        if (!name?.startsWith('--') || value === undefined) {
            throw new Error(`Invalid command-line argument: ${name ?? ''}`);
        }
        options[name.slice(2)] = value;
    }
    return { command, options };
}

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function main(argv = process.argv.slice(2)) {
    const { command, options } = parseArguments(argv);
    if (
        command === 'prepare' &&
        options['runtime-manifest'] &&
        options.checkout &&
        options.output &&
        options['record-output']
    ) {
        const runtimeManifest = readJson(options['runtime-manifest']);
        const sourcePackage = runtimeManifest?.packages?.libplacebo;
        const record = prepareLinuxRuntimeSourceSnapshot({
            checkoutPath: options.checkout,
            outputPath: options.output,
            expected: {
                sourceGitCommit: sourcePackage?.sourceGitCommit,
                sourceSubmodules: sourcePackage?.sourceSubmodules,
            },
        });
        writeJson(options['record-output'], record);
        return;
    }
    if (command === 'assert-vcs-free' && options.directory) {
        assertNoGitMetadata(options.directory);
        return;
    }
    throw new Error(
        'Usage: prepare-linux-runtime-source-snapshot.cjs prepare --runtime-manifest <path> --checkout <path> --output <path> --record-output <path> | assert-vcs-free --directory <path>'
    );
}

if (require.main === module) {
    try {
        main();
    } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    }
}

module.exports = {
    assertNoGitMetadata,
    inspectCleanGitSource,
    prepareLinuxRuntimeSourceSnapshot,
};
