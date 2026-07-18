#!/usr/bin/env node

'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const { isDeepStrictEqual } = require('node:util');

const SOURCE_ARCHIVE_BINDING_SCHEMA_VERSION = 1;
const SOURCE_ARCHIVE_NAME = 'linux-frame-copy-runtime-sources.tar.xz';
const SOURCE_ARCHIVE_BINDING_NAME = 'source-archive-binding.json';
const GIT_COMMIT_PATTERN = /^[a-f0-9]{40,64}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function validateLinuxSourceArchiveBinding(
    binding,
    { expectedRepositoryRevision, expectedSha256 } = {}
) {
    const errors = [];
    if (
        binding === null ||
        typeof binding !== 'object' ||
        Array.isArray(binding)
    ) {
        return ['Linux source archive binding must be an object.'];
    }
    if (
        !isDeepStrictEqual(Object.keys(binding).sort(), [
            'name',
            'repositoryRevision',
            'schemaVersion',
            'sha256',
        ])
    ) {
        errors.push(
            'Linux source archive binding must contain only schemaVersion, name, sha256, and repositoryRevision.'
        );
    }
    if (binding.schemaVersion !== SOURCE_ARCHIVE_BINDING_SCHEMA_VERSION) {
        errors.push(
            `Linux source archive binding schemaVersion must equal ${SOURCE_ARCHIVE_BINDING_SCHEMA_VERSION}.`
        );
    }
    if (binding.name !== SOURCE_ARCHIVE_NAME) {
        errors.push(
            `Linux source archive binding name must equal ${SOURCE_ARCHIVE_NAME}.`
        );
    }
    if (
        typeof binding.sha256 !== 'string' ||
        !SHA256_PATTERN.test(binding.sha256)
    ) {
        errors.push(
            'Linux source archive binding sha256 must be a lowercase SHA-256 digest.'
        );
    }
    if (
        typeof binding.repositoryRevision !== 'string' ||
        !GIT_COMMIT_PATTERN.test(binding.repositoryRevision)
    ) {
        errors.push(
            'Linux source archive binding repositoryRevision must be a full Git commit.'
        );
    }
    if (
        expectedRepositoryRevision !== undefined &&
        binding.repositoryRevision !== expectedRepositoryRevision
    ) {
        errors.push(
            'Linux source archive binding repositoryRevision does not match the expected release commit.'
        );
    }
    if (expectedSha256 !== undefined && binding.sha256 !== expectedSha256) {
        errors.push(
            'Linux source archive binding sha256 does not match the source archive bytes.'
        );
    }
    return errors;
}

function sha256File(filePath) {
    const descriptor = fs.openSync(filePath, 'r');
    const hash = crypto.createHash('sha256');
    const buffer = Buffer.alloc(1024 * 1024);
    try {
        let bytesRead;
        do {
            bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
            if (bytesRead > 0) {
                hash.update(buffer.subarray(0, bytesRead));
            }
        } while (bytesRead > 0);
    } finally {
        fs.closeSync(descriptor);
    }
    return hash.digest('hex');
}

function createLinuxSourceArchiveBinding({ archivePath, repositoryRevision }) {
    const stat = fs.lstatSync(archivePath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size === 0) {
        throw new Error(
            'Linux source archive must be a non-empty regular file.'
        );
    }
    const binding = {
        schemaVersion: SOURCE_ARCHIVE_BINDING_SCHEMA_VERSION,
        name: SOURCE_ARCHIVE_NAME,
        sha256: sha256File(archivePath),
        repositoryRevision,
    };
    const errors = validateLinuxSourceArchiveBinding(binding);
    if (errors.length > 0) {
        throw new Error(errors.join('\n'));
    }
    return binding;
}

function parseArguments(argv) {
    const [command, ...tokens] = argv;
    if (tokens.length % 2 !== 0) {
        throw new Error('Linux source archive binding arguments are invalid.');
    }
    const options = {};
    for (let index = 0; index < tokens.length; index += 2) {
        const token = tokens[index];
        const value = tokens[index + 1];
        if (
            !token.startsWith('--') ||
            value === undefined ||
            Object.hasOwn(options, token.slice(2))
        ) {
            throw new Error(
                'Linux source archive binding arguments are invalid.'
            );
        }
        options[token.slice(2)] = value;
    }
    return { command, options };
}

function main(argv = process.argv.slice(2)) {
    const { command, options } = parseArguments(argv);
    if (
        command !== 'create' ||
        !options.archive ||
        !options['repository-revision'] ||
        !options.output
    ) {
        throw new Error(
            'Usage: linux-source-archive-contract.cjs create --archive <path> --repository-revision <commit> --output <path>'
        );
    }
    const binding = createLinuxSourceArchiveBinding({
        archivePath: options.archive,
        repositoryRevision: options['repository-revision'],
    });
    fs.writeFileSync(options.output, `${JSON.stringify(binding, null, 2)}\n`, {
        mode: 0o644,
    });
}

if (require.main === module) {
    try {
        main();
    } catch (error) {
        process.stderr.write(
            `${error instanceof Error ? error.message : String(error)}\n`
        );
        process.exitCode = 1;
    }
}

module.exports = {
    SOURCE_ARCHIVE_BINDING_NAME,
    SOURCE_ARCHIVE_BINDING_SCHEMA_VERSION,
    SOURCE_ARCHIVE_NAME,
    createLinuxSourceArchiveBinding,
    sha256File,
    validateLinuxSourceArchiveBinding,
};
