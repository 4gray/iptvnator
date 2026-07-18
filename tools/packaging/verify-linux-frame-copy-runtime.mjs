#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { collectEmbeddedMpvNativeArchiveEntries } from './asar-dependency-closure.mjs';

const require = createRequire(import.meta.url);
const { listPackage: defaultListAsarPackage } = require('@electron/asar');
const {
    parseReadelfDynamic,
} = require('../embedded-mpv/build-linux-runtime.cjs');
const {
    listElectronShippedLinuxLibraries,
    validatePackagedEmbeddedMpv,
} = require('./embedded-mpv-packaging.cjs');
const {
    LINUX_SYSTEM_PACKAGE_DEPENDENCIES,
    resolveLinuxFrameCopyProfile,
} = require('./linux-frame-copy-profile.cjs');
const {
    RUNTIME_PROBE_MAX_BUFFER_BYTES,
    RUNTIME_PROBE_TIMEOUT_MS,
} = require('../embedded-mpv/runtime-probe-contract.cjs');

const scriptPath = fileURLToPath(import.meta.url);
const LIBMPV_DEPENDENCY_PATTERN = /^libmpv\.so(?:\.|$)/;
// Keep this set identical to the packaged helper sanitizer in
// embedded-mpv-frame-copy-runtime/helper-environment.ts. Feature/debug
// selectors such as LIBGL_ALWAYS_SOFTWARE remain intentionally available.
const UNSAFE_RUNTIME_PROBE_ENVIRONMENT_VARIABLES = [
    'BASH_ENV',
    'ENV',
    'BASHOPTS',
    'SHELLOPTS',
    'PS4',
    'BASH_XTRACEFD',
    'CDPATH',
    'LD_AUDIT',
    'LD_LIBRARY_PATH',
    'LD_ORIGIN_PATH',
    'LD_PRELOAD',
    '__EGL_EXTERNAL_PLATFORM_CONFIG_DIRS',
    '__EGL_EXTERNAL_PLATFORM_CONFIG_FILENAMES',
    '__EGL_VENDOR_LIBRARY_DIRS',
    '__EGL_VENDOR_LIBRARY_FILENAMES',
    'GBM_BACKEND',
    'GBM_BACKENDS_PATH',
    'LIBGL_DRIVERS_PATH',
    'MESA_LOADER_DRIVER_OVERRIDE',
    'LIBVA_DRIVER_NAME',
    'LIBVA_DRIVERS_PATH',
    'VDPAU_DRIVER_PATH',
    'VK_DRIVER_FILES',
    'VK_ICD_FILENAMES',
    'VK_ADD_DRIVER_FILES',
    'VK_ADD_LAYER_PATH',
    'VK_IMPLICIT_LAYER_PATH',
    'VK_ADD_IMPLICIT_LAYER_PATH',
    'VK_LAYER_PATH',
];

function defaultRunCommand(command, args, options = {}) {
    return spawnSync(command, args, {
        cwd: options.cwd,
        env: options.env,
        encoding: 'utf8',
        stdio: 'pipe',
        timeout: options.timeout,
        killSignal: options.killSignal,
        maxBuffer: options.maxBuffer,
        windowsHide: true,
    });
}

function assertCommandSucceeded(command, args, result) {
    if (result?.error) {
        throw new Error(
            `Unable to run ${command}: ${
                result.error instanceof Error
                    ? result.error.message
                    : String(result.error)
            }`
        );
    }
    if (result?.status !== 0) {
        const details = [result?.stdout, result?.stderr]
            .filter(Boolean)
            .join('\n')
            .trim();
        throw new Error(
            `${command} ${args.join(' ')} failed with status ${
                result?.status ?? 'unknown'
            }.${details ? `\n${details}` : ''}`
        );
    }
    return result;
}

export function detectLinuxArtifactFormat(artifactPath) {
    const fileName = path.basename(artifactPath);
    if (/\.AppImage$/i.test(fileName)) {
        return 'appimage';
    }
    if (/\.deb$/i.test(fileName)) {
        return 'deb';
    }
    if (/\.rpm$/i.test(fileName)) {
        return 'rpm';
    }
    if (/\.(?:pacman|pkg\.tar(?:\.[A-Za-z0-9]+)*)$/i.test(fileName)) {
        return 'pacman';
    }
    if (/\.snap$/i.test(fileName)) {
        return 'snap';
    }
    if (/\.flatpak$/i.test(fileName)) {
        return 'flatpak';
    }
    throw new Error(`Unsupported Linux package artifact: ${artifactPath}`);
}

export function parseVerifierArguments(argv) {
    const normalizedArgs = argv[0] === '--' ? argv.slice(1) : [...argv];
    let artifactValue;
    let profileValue;
    for (let index = 0; index < normalizedArgs.length; index += 1) {
        const argument = normalizedArgs[index];
        if (argument === '--artifact') {
            if (artifactValue !== undefined) {
                throw new Error('Received duplicate --artifact argument.');
            }
            artifactValue = normalizedArgs[++index];
            continue;
        }
        if (argument === '--profile') {
            if (profileValue !== undefined) {
                throw new Error('Received duplicate --profile argument.');
            }
            profileValue = normalizedArgs[++index];
            continue;
        }
        throw new Error(`Unsupported verifier argument: ${argument}`);
    }
    if (!artifactValue) {
        throw new Error('--artifact is required.');
    }
    if (!profileValue) {
        throw new Error('--profile is required.');
    }
    const artifactPath = path.resolve(artifactValue);
    const stat = fs.lstatSync(artifactPath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new Error(
            `Linux package artifact must be a regular file: ${artifactPath}`
        );
    }
    const profile = resolveLinuxFrameCopyProfile(profileValue);
    detectLinuxArtifactFormat(artifactPath);
    return {
        artifactPath,
        profileName: profile.name,
    };
}

export function findAppImageSquashfsOffsets(artifactPath) {
    const magic = Buffer.from('hsqs');
    const chunkSize = 1024 * 1024;
    const descriptor = fs.openSync(artifactPath, 'r');
    const offsets = [];
    let position = 0;
    let overlap = Buffer.alloc(0);
    try {
        while (true) {
            const chunk = Buffer.alloc(chunkSize);
            const bytesRead = fs.readSync(
                descriptor,
                chunk,
                0,
                chunk.length,
                position
            );
            if (bytesRead === 0) {
                break;
            }
            const contents = Buffer.concat([
                overlap,
                chunk.subarray(0, bytesRead),
            ]);
            const contentsStart = position - overlap.length;
            let searchOffset = 0;
            while (searchOffset <= contents.length - magic.length) {
                const matchOffset = contents.indexOf(magic, searchOffset);
                if (matchOffset === -1) {
                    break;
                }
                const absoluteOffset = contentsStart + matchOffset;
                if (offsets.at(-1) !== absoluteOffset) {
                    offsets.push(absoluteOffset);
                }
                searchOffset = matchOffset + 1;
            }
            overlap = contents.subarray(
                Math.max(0, contents.length - (magic.length - 1))
            );
            position += bytesRead;
        }
    } finally {
        fs.closeSync(descriptor);
    }
    return offsets;
}

export function extractLinuxArtifact({
    artifactPath,
    format,
    destination,
    runCommand = defaultRunCommand,
}) {
    fs.rmSync(destination, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    const run = (command, args, options = {}) =>
        assertCommandSucceeded(
            command,
            args,
            runCommand(command, args, options)
        );

    switch (format) {
        case 'appimage': {
            const squashfsOffsets = findAppImageSquashfsOffsets(artifactPath);
            if (squashfsOffsets.length === 0) {
                throw new Error(
                    `AppImage contains no SquashFS payload: ${artifactPath}`
                );
            }
            const failures = [];
            for (const offset of squashfsOffsets) {
                fs.rmSync(destination, { recursive: true, force: true });
                const args = [
                    '-no-progress',
                    '-offset',
                    String(offset),
                    '-dest',
                    destination,
                    artifactPath,
                ];
                const result = runCommand('unsquashfs', args);
                if (!result?.error && result?.status === 0) {
                    return destination;
                }
                failures.push(
                    [result?.stdout, result?.stderr]
                        .filter(Boolean)
                        .join('\n')
                        .trim()
                );
            }
            throw new Error(
                [
                    `Unable to extract the AppImage SquashFS payload at any candidate offset: ${artifactPath}`,
                    ...failures.filter(Boolean),
                ].join('\n')
            );
        }
        case 'deb':
            fs.mkdirSync(destination, { recursive: true });
            run('dpkg-deb', ['--extract', artifactPath, destination]);
            return destination;
        case 'rpm':
        case 'pacman':
            fs.mkdirSync(destination, { recursive: true });
            run('bsdtar', [
                '--extract',
                '--file',
                artifactPath,
                '--directory',
                destination,
            ]);
            return destination;
        case 'snap':
            run('unsquashfs', [
                '-no-progress',
                '-dest',
                destination,
                artifactPath,
            ]);
            return destination;
        case 'flatpak': {
            fs.mkdirSync(destination, { recursive: true });
            const repository = path.join(destination, '.ostree-repository');
            const checkout = path.join(destination, 'checkout');
            fs.mkdirSync(repository, { recursive: true });
            run('ostree', [
                `--repo=${repository}`,
                'init',
                '--mode=archive-z2',
            ]);
            run('flatpak', ['build-import-bundle', repository, artifactPath]);
            const refsResult = run('ostree', ['refs', `--repo=${repository}`]);
            const refs = String(refsResult.stdout ?? '')
                .split(/\r?\n/)
                .map((line) => line.trim())
                .filter((line) => line.startsWith('app/'));
            if (refs.length !== 1) {
                throw new Error(
                    `Flatpak bundle must import exactly one application ref; received ${
                        refs.length > 0 ? refs.join(', ') : '<none>'
                    }.`
                );
            }
            run('ostree', [
                'checkout',
                '-U',
                `--repo=${repository}`,
                refs[0],
                checkout,
            ]);
            return checkout;
        }
        default:
            throw new Error(`Unsupported Linux package format: ${format}`);
    }
}

export function findExtractedResourceDir(extractionRoot) {
    const candidates = [];

    function visit(directoryPath) {
        let entries;
        try {
            entries = fs.readdirSync(directoryPath, { withFileTypes: true });
        } catch (error) {
            throw new Error(
                `Unable to inspect extracted package directory ${directoryPath}: ${
                    error instanceof Error ? error.message : String(error)
                }`
            );
        }
        for (const entry of entries) {
            if (!entry.isDirectory() || entry.isSymbolicLink()) {
                continue;
            }
            const entryPath = path.join(directoryPath, entry.name);
            if (entry.name === 'resources') {
                const nativeDir = path.join(
                    entryPath,
                    'app.asar.unpacked',
                    'electron-backend',
                    'native'
                );
                let nativeStat;
                try {
                    nativeStat = fs.lstatSync(nativeDir);
                } catch {
                    nativeStat = null;
                }
                if (nativeStat?.isDirectory() && !nativeStat.isSymbolicLink()) {
                    candidates.push(entryPath);
                    continue;
                }
            }
            visit(entryPath);
        }
    }

    visit(extractionRoot);
    if (candidates.length !== 1) {
        throw new Error(
            `Expected exactly one embedded MPV native payload in ${extractionRoot}; found ${candidates.length}.`
        );
    }
    return candidates[0];
}

function stripYamlTrailingComment(value) {
    let quote = null;
    for (let index = 0; index < value.length; index += 1) {
        const character = value[index];
        if (quote === "'") {
            if (character === "'" && value[index + 1] === "'") {
                index += 1;
            } else if (character === "'") {
                quote = null;
            }
            continue;
        }
        if (quote === '"') {
            if (character === '\\') {
                index += 1;
            } else if (character === '"') {
                quote = null;
            }
            continue;
        }
        if (character === "'" || character === '"') {
            quote = character;
            continue;
        }
        if (
            character === '#' &&
            (index === 0 || /[ \t]/.test(value[index - 1]))
        ) {
            return value.slice(0, index).trimEnd();
        }
    }
    return value;
}

function yamlMappingEntries(lines, key, indent, start = 0, end = lines.length) {
    const prefix = `${' '.repeat(indent)}${key}:`;
    return lines
        .map((line, index) => ({ index, line }))
        .filter(
            ({ index, line }) =>
                index >= start &&
                index < end &&
                line.startsWith(prefix) &&
                line.slice(prefix.length).match(/^(?:\s|$)/) &&
                line.length - line.trimStart().length === indent
        )
        .map(({ index, line }) => {
            let blockEnd = end;
            for (
                let candidateIndex = index + 1;
                candidateIndex < end;
                candidateIndex += 1
            ) {
                const candidate = lines[candidateIndex];
                if (
                    !candidate.trim() ||
                    candidate.trimStart().startsWith('#')
                ) {
                    continue;
                }
                const candidateIndent =
                    candidate.length - candidate.trimStart().length;
                if (candidateIndent <= indent) {
                    blockEnd = candidateIndex;
                    break;
                }
            }
            return {
                index,
                end: blockEnd,
                value: stripYamlTrailingComment(
                    line.slice(prefix.length).trim()
                ),
            };
        });
}

function singleYamlMappingEntry(lines, key, indent, start, end) {
    const entries = yamlMappingEntries(lines, key, indent, start, end);
    return entries.length === 1 ? entries[0] : null;
}

function directYamlMappingEntries(lines, parent, indent) {
    const entries = [];
    for (let index = parent.index + 1; index < parent.end; index += 1) {
        const line = lines[index];
        if (!line.trim() || line.trimStart().startsWith('#')) {
            continue;
        }
        const lineIndent = line.length - line.trimStart().length;
        if (lineIndent !== indent) {
            continue;
        }
        const match = line
            .slice(indent)
            .match(/^([A-Za-z0-9][A-Za-z0-9_-]*):(?:\s*(.*))?$/);
        if (!match) {
            return null;
        }
        let blockEnd = parent.end;
        for (
            let candidateIndex = index + 1;
            candidateIndex < parent.end;
            candidateIndex += 1
        ) {
            const candidate = lines[candidateIndex];
            if (!candidate.trim() || candidate.trimStart().startsWith('#')) {
                continue;
            }
            const candidateIndent =
                candidate.length - candidate.trimStart().length;
            if (candidateIndent <= indent) {
                blockEnd = candidateIndex;
                break;
            }
        }
        entries.push({
            key: match[1],
            value: stripYamlTrailingComment(match[2] ?? ''),
            index,
            end: blockEnd,
        });
    }
    return entries;
}

function directYamlAbsolutePathMappingEntries(lines, parent, indent) {
    const entries = [];
    for (let index = parent.index + 1; index < parent.end; index += 1) {
        const line = lines[index];
        if (!line.trim() || line.trimStart().startsWith('#')) {
            continue;
        }
        const lineIndent = line.length - line.trimStart().length;
        if (lineIndent !== indent) {
            continue;
        }
        const match = line
            .slice(indent)
            .match(/^(\/[A-Za-z0-9._/-]+):(?:\s*(.*))?$/);
        if (!match) {
            return null;
        }
        let blockEnd = parent.end;
        for (
            let candidateIndex = index + 1;
            candidateIndex < parent.end;
            candidateIndex += 1
        ) {
            const candidate = lines[candidateIndex];
            if (!candidate.trim() || candidate.trimStart().startsWith('#')) {
                continue;
            }
            const candidateIndent =
                candidate.length - candidate.trimStart().length;
            if (candidateIndent <= indent) {
                blockEnd = candidateIndex;
                break;
            }
        }
        entries.push({
            key: match[1],
            value: stripYamlTrailingComment(match[2] ?? ''),
            index,
            end: blockEnd,
        });
    }
    return entries;
}

function yamlScalarEquals(value, expected) {
    return (
        value === expected ||
        value === JSON.stringify(expected) ||
        value === `'${expected.replaceAll("'", "''")}'`
    );
}

function yamlSequenceIncludes(lines, entry, expected) {
    if (entry.value) {
        if (!entry.value.startsWith('[') || !entry.value.endsWith(']')) {
            return false;
        }
        const values = entry.value
            .slice(1, -1)
            .split(',')
            .map((value) => value.trim());
        return (
            values.length > 0 &&
            values.every(
                (value) =>
                    value.length > 0 &&
                    !/[:[\]{}&*]/.test(value) &&
                    !value.startsWith('-')
            ) &&
            values.some((value) => yamlScalarEquals(value, expected))
        );
    }
    const sequenceLines = lines
        .slice(entry.index + 1, entry.end)
        .filter((line) => line.trim() && !line.trimStart().startsWith('#'));
    const itemIndent = 6;
    const values = sequenceLines.map((line) => {
        const lineIndent = line.length - line.trimStart().length;
        if (lineIndent !== itemIndent) {
            return null;
        }
        const match = line.trim().match(/^-\s+([^:[\]{}&*]+)$/);
        return match ? stripYamlTrailingComment(match[1].trim()) : null;
    });
    return (
        values.length > 0 &&
        values.every((value) => value !== null) &&
        values.some((value) => yamlScalarEquals(value, expected))
    );
}

function yamlSyntaxOutsideQuotedScalars(line) {
    let result = '';
    let quote = null;
    for (let index = 0; index < line.length; index += 1) {
        const character = line[index];
        if (quote === "'") {
            if (character === "'" && line[index + 1] === "'") {
                result += '  ';
                index += 1;
            } else {
                result += ' ';
                if (character === "'") {
                    quote = null;
                }
            }
            continue;
        }
        if (quote === '"') {
            result += ' ';
            if (character === '\\') {
                result += ' ';
                index += 1;
            } else if (character === '"') {
                quote = null;
            }
            continue;
        }
        if (character === '#') {
            break;
        }
        if (character === "'" || character === '"') {
            quote = character;
            result += ' ';
            continue;
        }
        result += character;
    }
    return result;
}

function containsUnsupportedYamlSemantics(lines) {
    let blockScalarParentIndent = null;
    for (const line of lines) {
        if (!line.trim()) {
            continue;
        }
        const lineIndent = line.length - line.trimStart().length;
        if (
            blockScalarParentIndent !== null &&
            lineIndent > blockScalarParentIndent
        ) {
            continue;
        }
        blockScalarParentIndent = null;
        const syntax = yamlSyntaxOutsideQuotedScalars(line);
        if (
            /(?:^|[\s:[\]{},])(?:[&*][^\s,[\]{}]+|![^\s,[\]{}]+)(?=$|[\s,\]}])/.test(
                syntax
            ) ||
            /(?:^|\s)<<\s*:/.test(syntax)
        ) {
            return true;
        }
        if (/:\s*[>|][+-]?\d?\s*$/.test(syntax)) {
            blockScalarParentIndent = lineIndent;
        }
    }
    return false;
}

export function validateExtractedSnapMetadata(extractionRoot) {
    const snapYamlPath = path.join(extractionRoot, 'meta', 'snap.yaml');
    let stat;
    try {
        stat = fs.lstatSync(snapYamlPath);
    } catch {
        return [`Missing extracted Snap metadata: ${snapYamlPath}`];
    }
    if (!stat.isFile() || stat.isSymbolicLink()) {
        return [
            `Extracted Snap metadata must be a regular file: ${snapYamlPath}`,
        ];
    }

    let contents;
    try {
        contents = fs.readFileSync(snapYamlPath, 'utf8');
    } catch (error) {
        return [
            `Unable to read extracted Snap metadata at ${snapYamlPath}: ${
                error instanceof Error ? error.message : String(error)
            }`,
        ];
    }
    if (contents.includes('\t')) {
        return [
            `Extracted Snap metadata must use space indentation: ${snapYamlPath}`,
        ];
    }
    const lines = contents.split(/\r?\n/);
    if (containsUnsupportedYamlSemantics(lines)) {
        return [
            'Extracted Snap metadata must not use YAML anchors, aliases, merge keys, or custom tags.',
        ];
    }
    const errors = [];
    const graphicsMountPath = path.join(extractionRoot, 'graphics');
    let graphicsMountStat;
    try {
        graphicsMountStat = fs.lstatSync(graphicsMountPath);
    } catch {
        errors.push(
            `Extracted Snap must contain an empty graphics content mount directory: ${graphicsMountPath}`
        );
    }
    if (
        graphicsMountStat &&
        (!graphicsMountStat.isDirectory() || graphicsMountStat.isSymbolicLink())
    ) {
        errors.push(
            `Extracted Snap graphics content mount must be a real directory: ${graphicsMountPath}`
        );
    } else if (graphicsMountStat) {
        if ((graphicsMountStat.mode & 0o777) !== 0o755) {
            errors.push(
                `Extracted Snap graphics content mount directory must have mode 0755: ${graphicsMountPath}`
            );
        }
        try {
            if (fs.readdirSync(graphicsMountPath).length > 0) {
                errors.push(
                    `Extracted Snap graphics content mount directory must be empty: ${graphicsMountPath}`
                );
            }
        } catch (error) {
            errors.push(
                `Unable to inspect extracted Snap graphics content mount at ${graphicsMountPath}: ${
                    error instanceof Error ? error.message : String(error)
                }`
            );
        }
    }
    const base = singleYamlMappingEntry(lines, 'base', 0, 0, lines.length);
    if (!base || !yamlScalarEquals(base.value, 'core22')) {
        errors.push('Extracted Snap metadata must declare base: core22.');
    }
    const confinement = singleYamlMappingEntry(
        lines,
        'confinement',
        0,
        0,
        lines.length
    );
    if (!confinement || !yamlScalarEquals(confinement.value, 'strict')) {
        errors.push(
            'Extracted Snap metadata must declare confinement: strict.'
        );
    }
    const layout = singleYamlMappingEntry(lines, 'layout', 0, 0, lines.length);
    if (!layout || layout.value) {
        errors.push(
            'Extracted Snap metadata must declare the exact Snap graphics layout contract.'
        );
    } else {
        const layoutEntries = directYamlAbsolutePathMappingEntries(
            lines,
            layout,
            2
        );
        const expectedLayouts = [
            {
                path: '/usr/share/libdrm',
                field: 'bind',
                target: '$SNAP/graphics/libdrm',
                label: 'libdrm',
            },
            {
                path: '/usr/share/drirc.d',
                field: 'symlink',
                target: '$SNAP/graphics/drirc.d',
                label: 'drirc.d',
            },
        ];
        if (
            layoutEntries &&
            new Set(layoutEntries.map(({ key }) => key)).size !==
                layoutEntries.length
        ) {
            errors.push('Extracted Snap layout paths must be unique.');
        }
        if (
            !layoutEntries ||
            layoutEntries.length !== expectedLayouts.length ||
            expectedLayouts.some(
                ({ path: expectedPath }) =>
                    layoutEntries.filter(({ key }) => key === expectedPath)
                        .length !== 1
            )
        ) {
            errors.push(
                'Extracted Snap graphics layout must contain exactly the libdrm and drirc.d entries.'
            );
        }
        for (const expected of expectedLayouts) {
            const entry = layoutEntries?.find(
                ({ key }) => key === expected.path
            );
            const fields =
                entry && !entry.value
                    ? directYamlMappingEntries(lines, entry, 4)
                    : null;
            if (
                !fields ||
                fields.length !== 1 ||
                fields[0].key !== expected.field
            ) {
                errors.push(
                    `Extracted Snap ${expected.label} layout must contain exactly ${expected.field}.`
                );
            }
            if (
                !fields ||
                fields.filter(
                    ({ key, value }) =>
                        key === expected.field &&
                        yamlScalarEquals(value, expected.target)
                ).length !== 1
            ) {
                errors.push(
                    `Extracted Snap ${expected.label} layout must declare ${expected.field}: ${expected.target}.`
                );
            }
        }
    }
    const plugs = singleYamlMappingEntry(lines, 'plugs', 0, 0, lines.length);
    const sharedMemory =
        plugs &&
        singleYamlMappingEntry(
            lines,
            'shared-memory',
            2,
            plugs.index + 1,
            plugs.end
        );
    const graphicsCore22 =
        plugs &&
        singleYamlMappingEntry(
            lines,
            'graphics-core22',
            2,
            plugs.index + 1,
            plugs.end
        );
    if (!plugs || plugs.value || !sharedMemory || sharedMemory.value) {
        errors.push(
            'Extracted Snap metadata must declare exactly one top-level shared-memory plug.'
        );
    } else {
        const fields = directYamlMappingEntries(lines, sharedMemory, 4);
        const interfaceEntries =
            fields?.filter(({ key }) => key === 'interface') ?? [];
        const privateEntries =
            fields?.filter(({ key }) => key === 'private') ?? [];
        const interfaceEntry = interfaceEntries[0];
        const privateEntry = privateEntries[0];
        if (
            !fields ||
            fields.length !== 2 ||
            interfaceEntries.length !== 1 ||
            privateEntries.length !== 1
        ) {
            errors.push(
                'Extracted Snap private shared-memory plug must contain exactly interface and private.'
            );
        }
        if (
            !interfaceEntry ||
            !yamlScalarEquals(interfaceEntry.value, 'shared-memory')
        ) {
            errors.push(
                'Extracted Snap top-level shared-memory plug must declare interface: shared-memory.'
            );
        }
        if (!privateEntry || privateEntry.value !== 'true') {
            errors.push(
                'Extracted Snap top-level shared-memory plug must declare private: true.'
            );
        }

        const plugEntries = directYamlMappingEntries(lines, plugs, 2);
        if (!plugEntries || plugEntries.some(({ value }) => value.length > 0)) {
            errors.push(
                'Extracted Snap plug declarations must use block mappings.'
            );
        }
        if (
            plugEntries &&
            new Set(plugEntries.map(({ key }) => key)).size !==
                plugEntries.length
        ) {
            errors.push('Extracted Snap direct plug keys must be unique.');
        }
        const sharedMemoryInterfaces =
            plugEntries?.filter((plugEntry) => {
                const plugFields = directYamlMappingEntries(
                    lines,
                    plugEntry,
                    4
                );
                const interfaceFields =
                    plugFields?.filter(({ key }) => key === 'interface') ?? [];
                return (
                    interfaceFields.length === 1 &&
                    yamlScalarEquals(interfaceFields[0].value, 'shared-memory')
                );
            }) ?? [];
        if (
            !plugEntries ||
            sharedMemoryInterfaces.length !== 1 ||
            sharedMemoryInterfaces[0].key !== 'shared-memory'
        ) {
            errors.push(
                'Extracted Snap metadata must declare exactly one plug with the shared-memory interface.'
            );
        }
    }

    if (!plugs || plugs.value || !graphicsCore22 || graphicsCore22.value) {
        errors.push(
            'Extracted Snap metadata must declare exactly one top-level graphics-core22 plug.'
        );
    } else {
        const fields = directYamlMappingEntries(lines, graphicsCore22, 4);
        const interfaceEntries =
            fields?.filter(({ key }) => key === 'interface') ?? [];
        const targetEntries =
            fields?.filter(({ key }) => key === 'target') ?? [];
        const providerEntries =
            fields?.filter(({ key }) => key === 'default-provider') ?? [];
        const interfaceEntry = interfaceEntries[0];
        const targetEntry = targetEntries[0];
        const providerEntry = providerEntries[0];
        if (
            !fields ||
            fields.length !== 3 ||
            interfaceEntries.length !== 1 ||
            targetEntries.length !== 1 ||
            providerEntries.length !== 1
        ) {
            errors.push(
                'Extracted Snap graphics-core22 plug must contain exactly interface, target, and default-provider.'
            );
        }
        if (
            !interfaceEntry ||
            !yamlScalarEquals(interfaceEntry.value, 'content')
        ) {
            errors.push(
                'Extracted Snap graphics-core22 plug must declare interface: content.'
            );
        }
        if (
            !targetEntry ||
            !yamlScalarEquals(targetEntry.value, '$SNAP/graphics')
        ) {
            errors.push(
                'Extracted Snap graphics-core22 plug must declare target: $SNAP/graphics.'
            );
        }
        if (
            !providerEntry ||
            !yamlScalarEquals(providerEntry.value, 'mesa-core22')
        ) {
            errors.push(
                'Extracted Snap graphics-core22 plug must declare default-provider: mesa-core22.'
            );
        }

        const plugEntries = directYamlMappingEntries(lines, plugs, 2);
        const graphicsContracts =
            plugEntries?.filter((plugEntry) => {
                const plugFields = directYamlMappingEntries(
                    lines,
                    plugEntry,
                    4
                );
                if (!plugFields || plugFields.length !== 3) {
                    return false;
                }
                return [
                    ['interface', 'content'],
                    ['target', '$SNAP/graphics'],
                    ['default-provider', 'mesa-core22'],
                ].every(
                    ([key, expected]) =>
                        plugFields.filter(
                            ({ key: fieldKey, value }) =>
                                fieldKey === key &&
                                yamlScalarEquals(value, expected)
                        ).length === 1
                );
            }) ?? [];
        if (
            !plugEntries ||
            graphicsContracts.length !== 1 ||
            graphicsContracts[0].key !== 'graphics-core22'
        ) {
            errors.push(
                'Extracted Snap metadata must declare exactly one plug with the graphics-core22 contract.'
            );
        }
        const graphicsTargets =
            plugEntries?.filter((plugEntry) => {
                const plugFields = directYamlMappingEntries(
                    lines,
                    plugEntry,
                    4
                );
                return (
                    plugFields?.some(
                        ({ key, value }) =>
                            key === 'target' &&
                            yamlScalarEquals(value, '$SNAP/graphics')
                    ) ?? false
                );
            }) ?? [];
        if (
            !plugEntries ||
            graphicsTargets.length !== 1 ||
            graphicsTargets[0].key !== 'graphics-core22'
        ) {
            errors.push(
                'Extracted Snap metadata must declare exactly one plug with target $SNAP/graphics.'
            );
        }
    }

    const slotsEntries = yamlMappingEntries(lines, 'slots', 0, 0, lines.length);
    let hasSharedMemorySlot = slotsEntries.length > 1;
    let invalidSlotsShape = slotsEntries.some(({ value }) => value.length > 0);
    for (const slots of slotsEntries) {
        const slotEntries = directYamlMappingEntries(lines, slots, 2);
        if (!slotEntries) {
            invalidSlotsShape = true;
            continue;
        }
        invalidSlotsShape ||= slotEntries.some(({ value }) => value.length > 0);
        hasSharedMemorySlot ||= slotEntries.some((slotEntry) => {
            if (slotEntry.key === 'shared-memory') {
                return true;
            }
            const slotFields = directYamlMappingEntries(lines, slotEntry, 4);
            return (
                slotFields?.some(
                    ({ key, value }) =>
                        key === 'interface' &&
                        yamlScalarEquals(value, 'shared-memory')
                ) ?? false
            );
        });
    }
    if (invalidSlotsShape) {
        errors.push(
            'Extracted Snap slots must use block mappings with scalar fields.'
        );
    }
    if (hasSharedMemorySlot) {
        errors.push(
            'Extracted Snap metadata must not declare a shared-memory slot.'
        );
    }

    const apps = singleYamlMappingEntry(lines, 'apps', 0, 0, lines.length);
    const app =
        apps &&
        singleYamlMappingEntry(lines, 'iptvnator', 2, apps.index + 1, apps.end);
    const appPlugs =
        app &&
        singleYamlMappingEntry(lines, 'plugs', 4, app.index + 1, app.end);
    const appEnvironment =
        app &&
        singleYamlMappingEntry(lines, 'environment', 4, app.index + 1, app.end);
    const snapDesktopRuntime =
        appEnvironment &&
        singleYamlMappingEntry(
            lines,
            'SNAP_DESKTOP_RUNTIME',
            6,
            appEnvironment.index + 1,
            appEnvironment.end
        );
    if (
        !apps ||
        apps.value ||
        !app ||
        app.value ||
        !appPlugs ||
        !yamlSequenceIncludes(lines, appPlugs, 'shared-memory')
    ) {
        errors.push(
            'Extracted Snap iptvnator app scalar sequence must contain the shared-memory plug.'
        );
    }
    if (
        !apps ||
        apps.value ||
        !app ||
        app.value ||
        !appPlugs ||
        !yamlSequenceIncludes(lines, appPlugs, 'graphics-core22')
    ) {
        errors.push(
            'Extracted Snap iptvnator app scalar sequence must contain the graphics-core22 plug.'
        );
    }
    if (
        !appEnvironment ||
        appEnvironment.value ||
        !snapDesktopRuntime ||
        !yamlScalarEquals(snapDesktopRuntime.value, '$SNAP/gnome-platform')
    ) {
        errors.push(
            'Extracted Snap iptvnator app environment must declare SNAP_DESKTOP_RUNTIME: $SNAP/gnome-platform.'
        );
    }
    return errors;
}

export function readElfArchitecture(binaryPath) {
    const descriptor = fs.openSync(binaryPath, 'r');
    try {
        const header = Buffer.alloc(20);
        const bytesRead = fs.readSync(descriptor, header, 0, header.length, 0);
        if (
            bytesRead !== header.length ||
            !header.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))
        ) {
            throw new Error(`Not an ELF binary: ${binaryPath}`);
        }
        const byteOrder = header[5];
        const machine =
            byteOrder === 1
                ? header.readUInt16LE(18)
                : byteOrder === 2
                  ? header.readUInt16BE(18)
                  : null;
        const architecture = new Map([
            [62, 'x64'],
            [183, 'arm64'],
            [40, 'armv7l'],
        ]).get(machine);
        if (!architecture) {
            throw new Error(
                `Unsupported ELF machine ${String(machine)} in ${binaryPath}.`
            );
        }
        return architecture;
    } finally {
        fs.closeSync(descriptor);
    }
}

function normalizePackageArchitecture(value) {
    const normalized = String(value ?? '')
        .trim()
        .toLowerCase();
    const architecture = {
        amd64: 'x64',
        x86_64: 'x64',
        arm64: 'arm64',
        aarch64: 'arm64',
        armhf: 'armv7l',
        armv7h: 'armv7l',
        armv7hl: 'armv7l',
    }[normalized];
    if (!architecture) {
        throw new Error(
            `Unsupported Linux package architecture: ${
                normalized || '<empty>'
            }.`
        );
    }
    return architecture;
}

function splitNonEmptyLines(value) {
    return String(value ?? '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
}

function findPackageInfoFiles(extractionRoot) {
    const packageInfoPaths = [];

    function visit(directoryPath) {
        for (const entry of fs.readdirSync(directoryPath, {
            withFileTypes: true,
        })) {
            const entryPath = path.join(directoryPath, entry.name);
            if (entry.isDirectory() && !entry.isSymbolicLink()) {
                visit(entryPath);
            } else if (entry.isFile() && entry.name === '.PKGINFO') {
                packageInfoPaths.push(entryPath);
            }
        }
    }

    visit(extractionRoot);
    return packageInfoPaths;
}

export function readLinuxArtifactMetadata({
    artifactPath,
    format,
    extractionRoot,
    runCommand = defaultRunCommand,
}) {
    const run = (command, args) =>
        assertCommandSucceeded(command, args, runCommand(command, args));
    if (format === 'deb') {
        const architectureResult = run('dpkg-deb', [
            '--field',
            artifactPath,
            'Architecture',
        ]);
        const dependencyResult = run('dpkg-deb', [
            '--field',
            artifactPath,
            'Depends',
        ]);
        return {
            declaredArch: normalizePackageArchitecture(
                architectureResult.stdout
            ),
            dependencies: String(dependencyResult.stdout ?? '')
                .split(',')
                .map((dependency) => dependency.trim())
                .filter(Boolean),
        };
    }
    if (format === 'rpm') {
        const architectureResult = run('rpm', [
            '-qp',
            '--queryformat',
            '%{ARCH}\\n',
            artifactPath,
        ]);
        const dependencyResult = run('rpm', [
            '-qp',
            '--requires',
            artifactPath,
        ]);
        return {
            declaredArch: normalizePackageArchitecture(
                architectureResult.stdout
            ),
            dependencies: splitNonEmptyLines(dependencyResult.stdout),
        };
    }
    if (format === 'pacman') {
        const packageInfoPaths = findPackageInfoFiles(extractionRoot);
        if (packageInfoPaths.length !== 1) {
            throw new Error(
                `Pacman payload must contain exactly one .PKGINFO; found ${packageInfoPaths.length}.`
            );
        }
        const fields = fs
            .readFileSync(packageInfoPaths[0], 'utf8')
            .split(/\r?\n/)
            .map((line) => line.match(/^([^=]+?)\s*=\s*(.*)$/))
            .filter(Boolean)
            .map((match) => ({
                name: match[1].trim(),
                value: match[2].trim(),
            }));
        const architectures = fields
            .filter(({ name }) => name === 'arch')
            .map(({ value }) => value);
        if (architectures.length !== 1) {
            throw new Error(
                `Pacman .PKGINFO must declare exactly one architecture; found ${architectures.length}.`
            );
        }
        return {
            declaredArch: normalizePackageArchitecture(architectures[0]),
            dependencies: fields
                .filter(({ name }) => name === 'depend')
                .map(({ value }) => value),
        };
    }
    return {
        declaredArch: null,
        dependencies: [],
    };
}

function dependencyMatches(dependency, expected) {
    const escapedExpected = expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`^${escapedExpected}(?:$|\\s|[<>=])`).test(
        dependency.trim()
    );
}

export function validateSystemPackageDependencies(format, dependencies) {
    const expectedDependencies = LINUX_SYSTEM_PACKAGE_DEPENDENCIES[format];
    if (!expectedDependencies) {
        return [];
    }
    if (!Array.isArray(dependencies)) {
        return [
            `Linux ${format} package dependency metadata must be an array.`,
        ];
    }
    return expectedDependencies.flatMap((expectedDependency) =>
        dependencies.some((dependency) =>
            dependencyMatches(String(dependency), expectedDependency)
        )
            ? []
            : [
                  `Linux x64 ${format} package must declare ${expectedDependency}.`,
              ]
    );
}

function validateForeignPackageDependencies(format, dependencies) {
    const forbiddenDependencies =
        LINUX_SYSTEM_PACKAGE_DEPENDENCIES[format] ?? [];
    return forbiddenDependencies.flatMap((forbiddenDependency) =>
        dependencies.some((dependency) =>
            dependencyMatches(String(dependency), forbiddenDependency)
        )
            ? [
                  `Linux foreign-architecture ${format} package must not declare frame-copy dependency ${forbiddenDependency}.`,
              ]
            : []
    );
}

function dependencyFileName(dependencyName) {
    return String(dependencyName).replaceAll('\\', '/').split('/').at(-1) ?? '';
}

function validateElectronIsolation(resourceDir, artifactFormat, elfInspector) {
    const errors = [];
    const electronPath = path.join(path.dirname(resourceDir), 'iptvnator.bin');
    const binaries = [
        { label: 'Electron binary', binaryPath: electronPath },
        ...listElectronShippedLinuxLibraries(resourceDir, {
            artifactFormat,
        }).map((binaryPath) => ({
            label: 'Electron library',
            binaryPath,
        })),
    ];
    for (const { label, binaryPath } of binaries) {
        let stat;
        try {
            stat = fs.lstatSync(binaryPath);
        } catch {
            errors.push(`Missing ${label}: ${binaryPath}`);
            continue;
        }
        if (!stat.isFile() || stat.isSymbolicLink()) {
            errors.push(`${label} must be a regular file: ${binaryPath}`);
            continue;
        }
        let dynamic;
        try {
            dynamic = elfInspector(binaryPath);
        } catch (error) {
            errors.push(
                `Unable to inspect ${label} at ${binaryPath}: ${
                    error instanceof Error ? error.message : String(error)
                }`
            );
            continue;
        }
        if (!dynamic || !Array.isArray(dynamic.needed)) {
            errors.push(
                `ELF inspection for ${label} must provide a needed array: ${binaryPath}`
            );
            continue;
        }
        const libmpvDependencies = dynamic.needed.filter((dependencyName) =>
            LIBMPV_DEPENDENCY_PATTERN.test(dependencyFileName(dependencyName))
        );
        if (libmpvDependencies.length > 0) {
            errors.push(
                `${label} must not link libmpv; found ${libmpvDependencies.join(
                    ', '
                )} in ${binaryPath}.`
            );
        }
    }
    return errors;
}

function defaultElfInspector(binaryPath) {
    const result = assertCommandSucceeded(
        'readelf',
        ['-d', binaryPath],
        defaultRunCommand('readelf', ['-d', binaryPath])
    );
    return parseReadelfDynamic(result.stdout);
}

function validateProbeResult(result) {
    if (result?.error) {
        return [
            `Unable to execute Linux frame-copy runtime probe: ${
                result.error instanceof Error
                    ? result.error.message
                    : String(result.error)
            }`,
        ];
    }
    if (result?.signal) {
        return [
            `Linux frame-copy runtime probe terminated by signal ${result.signal}.`,
        ];
    }
    if (result?.status !== 0) {
        const details = [result?.stdout, result?.stderr]
            .filter(Boolean)
            .join('\n')
            .trim();
        return [
            `Linux frame-copy runtime probe failed with status ${
                result?.status ?? 'unknown'
            }.${details ? `\n${details}` : ''}`,
        ];
    }
    const stdout = result.stdout;
    if (typeof stdout !== 'string' || !/^[^\r\n]+\n$/.test(stdout)) {
        return [
            'Linux frame-copy runtime probe must emit exactly one newline-terminated JSON line.',
        ];
    }
    let payload;
    try {
        payload = JSON.parse(stdout.slice(0, -1));
    } catch (error) {
        return [
            `Linux frame-copy runtime probe emitted invalid JSON: ${
                error instanceof Error ? error.message : String(error)
            }`,
        ];
    }
    if (
        !payload ||
        typeof payload !== 'object' ||
        Array.isArray(payload) ||
        JSON.stringify(Object.keys(payload).sort()) !==
            JSON.stringify(['libmpv', 'protocol', 'renderApi', 'usable']) ||
        payload.protocol !== 1 ||
        payload.usable !== true ||
        typeof payload.libmpv !== 'string' ||
        payload.libmpv.trim() === '' ||
        payload.renderApi !== 'egl'
    ) {
        return [
            'Linux frame-copy runtime probe did not return protocol 1 usable EGL capability.',
        ];
    }
    return [];
}

export function createRuntimeProbeEnvironment({
    environment,
    nativeDir,
    runtimeMode,
}) {
    const probeEnvironment = { ...(environment ?? {}) };
    for (const variableName of UNSAFE_RUNTIME_PROBE_ENVIRONMENT_VARIABLES) {
        delete probeEnvironment[variableName];
    }
    for (const variableName of Object.keys(probeEnvironment)) {
        if (variableName.startsWith('BASH_FUNC_')) {
            delete probeEnvironment[variableName];
        }
    }
    if (runtimeMode === 'bundled') {
        probeEnvironment.LD_LIBRARY_PATH = path.join(nativeDir, 'lib');
    }
    return probeEnvironment;
}

function validateNoEmbeddedMpvNativeArchiveEntries(
    resourceDir,
    asarListPackage
) {
    const asarPath = path.join(resourceDir, 'app.asar');
    if (!fs.existsSync(asarPath)) {
        return [];
    }

    let nativeEntries;
    try {
        nativeEntries = collectEmbeddedMpvNativeArchiveEntries(
            asarListPackage(asarPath)
        );
    } catch (error) {
        return [
            `Unable to inspect embedded MPV archive ownership in ${asarPath}: ${
                error instanceof Error ? error.message : String(error)
            }`,
        ];
    }
    if (nativeEntries.length === 0) {
        return [];
    }
    return [
        [
            `Packaged app.asar must not contain embedded MPV native payloads; afterPack exclusively owns the profile-specific unpacked directory in ${asarPath}.`,
            ...nativeEntries.map((entry) => `- ${entry}`),
        ].join('\n'),
    ];
}

export function verifyExtractedLinuxFrameCopyRuntime({
    resourceDir,
    artifactFormat,
    profileName,
    packageDependencies = [],
    declaredArch = null,
    elfInspector = defaultElfInspector,
    probeRunner = defaultRunCommand,
    environment = process.env,
    asarListPackage = defaultListAsarPackage,
}) {
    const errors = [];
    let profile;
    try {
        profile = resolveLinuxFrameCopyProfile(profileName);
    } catch (error) {
        return [error instanceof Error ? error.message : String(error)];
    }
    if (!profile.targets.includes(artifactFormat)) {
        return [
            `Linux frame-copy profile "${profile.name}" does not include target "${artifactFormat}".`,
        ];
    }
    errors.push(
        ...validateNoEmbeddedMpvNativeArchiveEntries(
            resourceDir,
            asarListPackage
        )
    );

    const electronPath = path.join(path.dirname(resourceDir), 'iptvnator.bin');
    let packageArch;
    try {
        packageArch = readElfArchitecture(electronPath);
    } catch (error) {
        return [
            ...errors,
            error instanceof Error ? error.message : String(error),
        ];
    }
    const foreignArch = packageArch !== 'x64';
    if (declaredArch && declaredArch !== packageArch) {
        errors.push(
            `Package metadata architecture ${declaredArch} does not match Electron ELF architecture ${packageArch}.`
        );
    }
    if (profile.runtimeMode === 'system') {
        errors.push(
            ...(foreignArch
                ? validateForeignPackageDependencies(
                      artifactFormat,
                      packageDependencies
                  )
                : validateSystemPackageDependencies(
                      artifactFormat,
                      packageDependencies
                  ))
        );
    }

    errors.push(
        ...validatePackagedEmbeddedMpv(resourceDir, {
            platform: 'linux',
            required: true,
            foreignArch,
            targetArch: packageArch,
            profile: profile.name,
            targetNames: profile.targets,
            artifactFormat,
            hostPlatform: 'linux',
            executableName: 'iptvnator',
            elfInspector,
        })
    );
    errors.push(
        ...validateElectronIsolation(resourceDir, artifactFormat, elfInspector)
    );
    if (foreignArch || errors.length > 0) {
        return errors;
    }

    const nativeDir = path.join(
        resourceDir,
        'app.asar.unpacked',
        'electron-backend',
        'native'
    );
    const probeEnvironment = createRuntimeProbeEnvironment({
        environment,
        nativeDir,
        runtimeMode: profile.runtimeMode,
    });
    const probeResult = probeRunner(
        path.join(nativeDir, 'iptvnator_mpv_helper'),
        ['--runtime-probe'],
        {
            encoding: 'utf8',
            env: probeEnvironment,
            killSignal: 'SIGKILL',
            maxBuffer: RUNTIME_PROBE_MAX_BUFFER_BYTES,
            timeout: RUNTIME_PROBE_TIMEOUT_MS,
            windowsHide: true,
        }
    );
    errors.push(...validateProbeResult(probeResult));
    return errors;
}

export function verifyLinuxFrameCopyArtifact({
    artifactPath,
    profileName,
    runCommand = defaultRunCommand,
    extractArtifact = extractLinuxArtifact,
    metadataReader = readLinuxArtifactMetadata,
    payloadVerifier = verifyExtractedLinuxFrameCopyRuntime,
    elfInspector = defaultElfInspector,
    probeRunner = defaultRunCommand,
    environment = process.env,
}) {
    const resolvedArtifactPath = path.resolve(artifactPath);
    const artifactStat = fs.lstatSync(resolvedArtifactPath);
    if (!artifactStat.isFile() || artifactStat.isSymbolicLink()) {
        throw new Error(
            `Linux package artifact must be a regular file: ${resolvedArtifactPath}`
        );
    }
    const profile = resolveLinuxFrameCopyProfile(profileName);
    const format = detectLinuxArtifactFormat(resolvedArtifactPath);
    if (!profile.targets.includes(format)) {
        throw new Error(
            `Linux frame-copy profile "${profile.name}" does not include target "${format}".`
        );
    }

    const temporaryRoot = fs.mkdtempSync(
        path.join(os.tmpdir(), 'iptvnator-linux-package-verifier-')
    );
    try {
        const extractionDestination = path.join(temporaryRoot, 'payload');
        const extractionRoot = extractArtifact({
            artifactPath: resolvedArtifactPath,
            format,
            destination: extractionDestination,
            runCommand,
        });
        if (format === 'snap') {
            const snapMetadataErrors =
                validateExtractedSnapMetadata(extractionRoot);
            if (snapMetadataErrors.length > 0) {
                throw new Error(
                    [
                        `Linux frame-copy package verification failed for ${resolvedArtifactPath}:`,
                        ...snapMetadataErrors.map((error) => `- ${error}`),
                    ].join('\n')
                );
            }
        }
        const resourceDir = findExtractedResourceDir(extractionRoot);
        const metadata = metadataReader({
            artifactPath: resolvedArtifactPath,
            format,
            extractionRoot,
            runCommand,
        });
        const errors = payloadVerifier({
            resourceDir,
            artifactFormat: format,
            profileName: profile.name,
            packageDependencies: metadata.dependencies,
            declaredArch: metadata.declaredArch,
            elfInspector,
            probeRunner,
            environment,
        });
        if (errors.length > 0) {
            throw new Error(
                [
                    `Linux frame-copy package verification failed for ${resolvedArtifactPath}:`,
                    ...errors.map((error) => `- ${error}`),
                ].join('\n')
            );
        }
        const electronPath = path.join(
            path.dirname(resourceDir),
            'iptvnator.bin'
        );
        return {
            artifactPath: resolvedArtifactPath,
            format,
            profileName: profile.name,
            architecture: readElfArchitecture(electronPath),
        };
    } finally {
        fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
}

function main() {
    const options = parseVerifierArguments(process.argv.slice(2));
    const result = verifyLinuxFrameCopyArtifact(options);
    process.stdout.write(
        `Verified ${result.format} ${result.architecture} Linux frame-copy package (${result.profileName}): ${result.artifactPath}\n`
    );
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
    try {
        main();
    } catch (error) {
        process.stderr.write(
            `${error instanceof Error ? error.message : String(error)}\n`
        );
        process.exitCode = 1;
    }
}
