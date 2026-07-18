'use strict';

const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');
const {
    validateLinuxRuntimeManifest,
} = require('../embedded-mpv/linux-runtime-manifest.cjs');
const {
    EXPECTED_LIBPLACEBO_V7_360_1_SOURCE_SUBMODULES,
} = require('../embedded-mpv/build-linux-runtime.cjs');
const { validatePackagedEmbeddedMpv } = require('./embedded-mpv-packaging.cjs');
const {
    SOURCE_ARCHIVE_BINDING_SCHEMA_VERSION,
    SOURCE_ARCHIVE_NAME,
    sha256File,
    validateLinuxSourceArchiveBinding,
} = require('../embedded-mpv/linux-source-archive-contract.cjs');
const {
    EXPECTED_LIBPLACEBO_V7_360_1_SOURCE_SNAPSHOT_SHA256,
    inventoryLinuxRuntimeSourceSnapshot,
    validateLinuxRuntimeSourceSnapshot,
} = require('./prepare-linux-runtime-source-snapshot.cjs');

const COMMAND_OUTPUT_MAX_BUFFER_BYTES = 16 * 1024 * 1024;
const SQUASHFS_LIST_MAX_BUFFER_BYTES = 64 * 1024 * 1024;
const SOURCE_MEMBER_MAX_BUFFER_BYTES = 128 * 1024 * 1024;
const COMMAND_TIMEOUT_MS = 120_000;
const SOURCE_ARCHIVE_MAX_BYTES = 1024 * 1024 * 1024;
const SOURCE_ARCHIVE_EXTRACTED_MAX_BYTES = 2 * 1024 * 1024 * 1024;
const SNAP_ARCHIVE_MAX_BYTES = 1024 * 1024 * 1024;
const SNAP_EXTRACTED_MAX_BYTES = 2 * 1024 * 1024 * 1024;
const SOURCE_INDEX_SCHEMA_VERSION = 3;
const SNAP_PAYLOAD_ENTRY_LIMIT = 250_000;
const SOURCE_ARCHIVE_ENTRY_LIMIT = 250_000;
const GIT_COMMIT_PATTERN = /^[a-f0-9]{40,64}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SAFE_BASENAME_PATTERN = /^[A-Za-z0-9_+.-]+$/;
const FRAME_COPY_MANIFEST_NAME = 'embedded-mpv-runtime.json';
const FRAME_COPY_UNAVAILABLE_MARKER_NAME = 'embedded-mpv-unavailable.txt';
const NATIVE_PAYLOAD_SUFFIX = [
    'resources',
    'app.asar.unpacked',
    'electron-backend',
    'native',
].join('/');
const SOURCE_TOOLING_FILES = Object.freeze([
    {
        archivePath: 'tooling/build-linux-runtime.cjs',
        checkoutPath: path.join(
            __dirname,
            '..',
            'embedded-mpv',
            'build-linux-runtime.cjs'
        ),
    },
    {
        archivePath: 'tooling/build-linux-runtime.mjs',
        checkoutPath: path.join(
            __dirname,
            '..',
            'embedded-mpv',
            'build-linux-runtime.mjs'
        ),
    },
    {
        archivePath: 'tooling/generate-linux-runtime-notices.cjs',
        checkoutPath: path.join(
            __dirname,
            '..',
            'embedded-mpv',
            'generate-linux-runtime-notices.cjs'
        ),
    },
    {
        archivePath: 'tooling/linux-runtime-manifest.cjs',
        checkoutPath: path.join(
            __dirname,
            '..',
            'embedded-mpv',
            'linux-runtime-manifest.cjs'
        ),
    },
    {
        archivePath: 'tooling/linux-source-archive-contract.cjs',
        checkoutPath: path.join(
            __dirname,
            '..',
            'embedded-mpv',
            'linux-source-archive-contract.cjs'
        ),
    },
    {
        archivePath: 'tooling/stage-runtime.mjs',
        checkoutPath: path.join(
            __dirname,
            '..',
            'embedded-mpv',
            'stage-runtime.mjs'
        ),
    },
    {
        archivePath: 'tooling/prepare-linux-runtime-source-snapshot.cjs',
        checkoutPath: path.join(
            __dirname,
            'prepare-linux-runtime-source-snapshot.cjs'
        ),
    },
]);

function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function commandFailureDetails(result) {
    const stderr = Buffer.isBuffer(result?.stderr)
        ? result.stderr.toString('utf8')
        : String(result?.stderr ?? '');
    return stderr.trim().slice(0, 2048);
}

function defaultRunCommand(
    command,
    args,
    {
        encoding = 'utf8',
        input,
        maxBuffer = COMMAND_OUTPUT_MAX_BUFFER_BYTES,
        timeout = COMMAND_TIMEOUT_MS,
    } = {}
) {
    const spawnOptions = {
        killSignal: 'SIGKILL',
        maxBuffer,
        stdio: 'pipe',
        timeout,
        windowsHide: true,
    };
    if (input !== undefined) {
        spawnOptions.input = input;
    }
    if (encoding !== null) {
        spawnOptions.encoding = encoding;
    }
    const result = childProcess.spawnSync(command, args, spawnOptions);
    if (result.error) {
        throw new Error(
            `Unable to run ${command}: ${
                result.error instanceof Error
                    ? result.error.message
                    : String(result.error)
            }`
        );
    }
    if (result.status !== 0) {
        const details = commandFailureDetails(result);
        throw new Error(
            `${command} exited with status ${String(result.status)}${
                details ? `: ${details}` : '.'
            }`
        );
    }
    return result.stdout ?? (encoding === null ? Buffer.alloc(0) : '');
}

function normalizeTarMember(rawName) {
    if (
        typeof rawName !== 'string' ||
        rawName.length === 0 ||
        rawName.includes('\\') ||
        [...rawName].some((character) => {
            const codePoint = character.codePointAt(0);
            return codePoint <= 0x1f || codePoint === 0x7f;
        })
    ) {
        throw new Error('Source archive contains an unsafe member name.');
    }
    let memberName = rawName;
    while (memberName.startsWith('./')) {
        memberName = memberName.slice(2);
    }
    const isDirectory = memberName.endsWith('/');
    if (isDirectory) {
        memberName = memberName.slice(0, -1);
    }
    if (memberName === '') {
        return null;
    }
    const parts = memberName.split('/');
    if (
        path.posix.isAbsolute(memberName) ||
        parts.some(
            (part) =>
                part === '' ||
                part === '.' ||
                part === '..' ||
                !SAFE_BASENAME_PATTERN.test(part)
        )
    ) {
        throw new Error(
            `Source archive contains an unsafe member name: ${rawName}`
        );
    }
    return {
        isDirectory,
        name: parts.join('/'),
        rawName,
    };
}

function parseVerboseTarMembers(listing) {
    if (typeof listing !== 'string') {
        throw new Error('Unable to read source archive member types.');
    }
    const memberTypes = new Map();
    for (const line of listing.split(/\r?\n/).filter(Boolean)) {
        let type = line[0];
        if (!['-', 'd', 'h', 'l'].includes(type)) {
            throw new Error(
                'Source archive contains an unsupported member type.'
            );
        }
        let identity = line.trimEnd();
        let linkTarget = null;
        for (const marker of [' -> ', ' link to ']) {
            const markerIndex = identity.indexOf(marker);
            if (markerIndex !== -1) {
                linkTarget = identity.slice(markerIndex + marker.length);
                identity = identity.slice(0, markerIndex);
                if (marker === ' link to ') {
                    type = 'h';
                }
                break;
            }
        }
        const trimmedIdentity = identity.trim();
        const rawName = trimmedIdentity.split(/\s+/).at(-1);
        const rawNameOffset = trimmedIdentity.lastIndexOf(rawName);
        const metadataTokens = trimmedIdentity
            .slice(0, rawNameOffset)
            .trim()
            .split(/\s+/);
        const dateTokenIndex = metadataTokens.findIndex(
            (token) =>
                /^\d{4}-\d{2}-\d{2}$/.test(token) ||
                /^(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)$/.test(
                    token
                )
        );
        const sizeToken =
            dateTokenIndex > 0 ? metadataTokens[dateTokenIndex - 1] : '';
        const size = Number(sizeToken);
        if (
            !/^\d+$/.test(sizeToken) ||
            !Number.isSafeInteger(size) ||
            size < 0
        ) {
            throw new Error(
                'Unable to read a bounded source archive member size.'
            );
        }
        const member = normalizeTarMember(rawName);
        if (!member) {
            continue;
        }
        if (memberTypes.has(member.name)) {
            throw new Error(
                `Source archive contains duplicate verbose member: ${member.name}`
            );
        }
        if (member.isDirectory !== (type === 'd')) {
            throw new Error(
                `Source archive member type does not match its name: ${member.name}`
            );
        }
        if (type === 'l' || type === 'h') {
            if (
                typeof linkTarget !== 'string' ||
                linkTarget.length === 0 ||
                linkTarget.includes('\\') ||
                path.posix.isAbsolute(linkTarget) ||
                [...linkTarget].some((character) => {
                    const codePoint = character.codePointAt(0);
                    return codePoint <= 0x1f || codePoint === 0x7f;
                })
            ) {
                throw new Error(
                    `Source archive contains an unsafe link target: ${member.name}`
                );
            }
            const resolvedTarget =
                type === 'h'
                    ? path.posix.normalize(linkTarget)
                    : path.posix.normalize(
                          path.posix.join(
                              path.posix.dirname(member.name),
                              linkTarget
                          )
                      );
            if (resolvedTarget === '..' || resolvedTarget.startsWith('../')) {
                throw new Error(
                    `Source archive link target escapes its root: ${member.name}`
                );
            }
            linkTarget = resolvedTarget.replace(/^\.\/+/, '');
        } else if (linkTarget !== null) {
            throw new Error(
                `Source archive regular member has link metadata: ${member.name}`
            );
        }
        memberTypes.set(member.name, { linkTarget, size, type });
    }
    for (const [memberName, member] of memberTypes) {
        if (
            member.type === 'h' &&
            memberTypes.get(member.linkTarget)?.type !== '-'
        ) {
            throw new Error(
                `Source archive hardlink target must be a regular member: ${memberName}`
            );
        }
    }
    return memberTypes;
}

function listTarMembers(archivePath, runCommand) {
    const listing = runCommand(
        'tar',
        ['--list', '--ignore-zeros', '--xz', '--file', archivePath],
        {
            encoding: 'utf8',
            maxBuffer: COMMAND_OUTPUT_MAX_BUFFER_BYTES,
        }
    );
    if (typeof listing !== 'string') {
        throw new Error('Unable to read source archive member listing.');
    }
    const verboseMembers = parseVerboseTarMembers(
        runCommand(
            'tar',
            [
                '--list',
                '--verbose',
                '--ignore-zeros',
                '--xz',
                '--file',
                archivePath,
            ],
            {
                encoding: 'utf8',
                maxBuffer: COMMAND_OUTPUT_MAX_BUFFER_BYTES,
            }
        )
    );
    const members = new Map();
    let extractedBytes = 0;
    let entryCount = 0;
    for (const rawName of listing.split(/\r?\n/).filter(Boolean)) {
        const member = normalizeTarMember(rawName);
        if (!member) {
            continue;
        }
        if (members.has(member.name)) {
            throw new Error(
                `Source archive contains duplicate member: ${member.name}`
            );
        }
        const verboseMember = verboseMembers.get(member.name);
        if (!verboseMember) {
            throw new Error(
                `Source archive member type is missing: ${member.name}`
            );
        }
        entryCount += 1;
        if (entryCount > SOURCE_ARCHIVE_ENTRY_LIMIT) {
            throw new Error(
                'Source archive exceeds the release-verifier entry limit.'
            );
        }
        if (verboseMember.type === '-') {
            if (verboseMember.size > SOURCE_MEMBER_MAX_BUFFER_BYTES) {
                throw new Error(
                    `Source archive member exceeds the release-verifier size limit: ${member.name}`
                );
            }
            extractedBytes += verboseMember.size;
            if (
                !Number.isSafeInteger(extractedBytes) ||
                extractedBytes > SOURCE_ARCHIVE_EXTRACTED_MAX_BYTES
            ) {
                throw new Error(
                    'Source archive exceeds the release-verifier extracted-size limit.'
                );
            }
        }
        members.set(member.name, {
            ...member,
            ...verboseMember,
        });
    }
    if (verboseMembers.size !== members.size) {
        throw new Error(
            'Source archive member and type listings do not match.'
        );
    }
    return members;
}

function readTarMember(
    archivePath,
    members,
    memberName,
    runCommand,
    maxBuffer
) {
    const member = members.get(memberName);
    if (!member || member.type !== '-') {
        throw new Error(
            `Source archive required member must be a regular file: ${memberName}`
        );
    }
    const contents = runCommand(
        'tar',
        [
            '--extract',
            '--xz',
            '--to-stdout',
            '--file',
            archivePath,
            '--',
            member.rawName,
        ],
        {
            encoding: null,
            maxBuffer,
        }
    );
    const buffer = Buffer.isBuffer(contents) ? contents : Buffer.from(contents);
    if (buffer.length !== member.size) {
        throw new Error(
            `Source archive member size changed during inspection: ${memberName}`
        );
    }
    return buffer;
}

function parseJsonMember(contents, memberName) {
    try {
        return JSON.parse(contents.toString('utf8'));
    } catch {
        throw new Error(
            `Source archive member is not valid JSON: ${memberName}`
        );
    }
}

function sourceMemberRecord(
    archivePath,
    members,
    memberName,
    runCommand,
    relativePath
) {
    const contents = readTarMember(
        archivePath,
        members,
        memberName,
        runCommand,
        COMMAND_OUTPUT_MAX_BUFFER_BYTES
    );
    return {
        path: relativePath,
        sha256: crypto.createHash('sha256').update(contents).digest('hex'),
        size: contents.length,
    };
}

function inspectLegalFiles(
    archivePath,
    members,
    runCommand,
    rootName,
    rootFiles
) {
    const rootPrefix = `${rootName}/`;
    const licensePrefix = `${rootPrefix}licenses/`;
    const allowedRootFiles = new Set(
        rootFiles.map((name) => `${rootPrefix}${name}`)
    );
    const records = [];
    for (const member of members.values()) {
        if (member.isDirectory || !member.name.startsWith(rootPrefix)) {
            continue;
        }
        if (
            !member.name.startsWith(licensePrefix) &&
            !allowedRootFiles.has(member.name)
        ) {
            throw new Error(
                `Source archive contains an undeclared ${rootName} file: ${member.name}`
            );
        }
        if (member.name.startsWith(licensePrefix)) {
            records.push(
                sourceMemberRecord(
                    archivePath,
                    members,
                    member.name,
                    runCommand,
                    member.name.slice(rootPrefix.length)
                )
            );
        }
    }
    return records.sort(({ path: left }, { path: right }) =>
        left.localeCompare(right)
    );
}

function inspectLibplaceboSourceSnapshot(
    archivePath,
    members,
    runCommand,
    expectedSourceSnapshotSha256
) {
    const sourceRootName = 'git/libplacebo';
    const sourceRootMember = members.get(sourceRootName);
    if (!sourceRootMember || sourceRootMember.type !== 'd') {
        throw new Error(
            'Source archive must contain a regular libplacebo source directory.'
        );
    }
    const sourceMembers = [...members.values()].filter(
        ({ name }) =>
            name === sourceRootName || name.startsWith(`${sourceRootName}/`)
    );
    if (sourceMembers.length <= 1) {
        throw new Error(
            'Source archive must contain the prepared libplacebo source snapshot.'
        );
    }
    const temporaryRoot = fs.mkdtempSync(
        path.join(os.tmpdir(), 'iptvnator-libplacebo-source-verifier-')
    );
    try {
        runCommand(
            'tar',
            [
                '--extract',
                '--xz',
                '--file',
                archivePath,
                '--directory',
                temporaryRoot,
                '--no-same-owner',
                '--no-same-permissions',
                '-T',
                '/dev/stdin',
            ],
            {
                encoding: 'utf8',
                input: Buffer.from(
                    `${sourceMembers.map(({ rawName }) => rawName).join('\n')}\n`,
                    'utf8'
                ),
                maxBuffer: COMMAND_OUTPUT_MAX_BUFFER_BYTES,
            }
        );
        const sourceSnapshot = inventoryLinuxRuntimeSourceSnapshot(
            path.join(temporaryRoot, 'git', 'libplacebo')
        );
        return validateLinuxRuntimeSourceSnapshot(sourceSnapshot, {
            expectedSha256: expectedSourceSnapshotSha256,
        });
    } finally {
        fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
}

function inspectSourceCompliance(
    archivePath,
    members,
    runCommand,
    expectedSourceSnapshotSha256
) {
    if ([...members.keys()].some((name) => name.split('/').includes('.git'))) {
        throw new Error(
            'Source archive must not contain VCS metadata directories.'
        );
    }
    const expectedToolingNames = SOURCE_TOOLING_FILES.map(
        ({ archivePath: memberName }) => memberName
    ).sort();
    const actualToolingNames = [...members.values()]
        .filter(
            ({ isDirectory, name }) =>
                !isDirectory && name.startsWith('tooling/')
        )
        .map(({ name }) => name)
        .sort();
    if (!isDeepStrictEqual(actualToolingNames, expectedToolingNames)) {
        throw new Error(
            'Source archive must contain the exact released runtime tooling set.'
        );
    }
    for (const toolingFile of SOURCE_TOOLING_FILES) {
        const archivedContents = readTarMember(
            archivePath,
            members,
            toolingFile.archivePath,
            runCommand,
            COMMAND_OUTPUT_MAX_BUFFER_BYTES
        );
        const checkoutContents = fs.readFileSync(toolingFile.checkoutPath);
        if (!archivedContents.equals(checkoutContents)) {
            throw new Error(
                `Source archive tooling does not match the released tag: ${toolingFile.archivePath}`
            );
        }
    }
    const libplaceboSourceSnapshot = inspectLibplaceboSourceSnapshot(
        archivePath,
        members,
        runCommand,
        expectedSourceSnapshotSha256
    );
    const licenseInputManifestName =
        'license-inputs/linux-runtime-license-inputs.json';
    const noticeManifestName = 'notices/embedded-mpv-notices.json';
    const noticeFileName = 'notices/THIRD_PARTY_NOTICES.txt';
    const licenseInputs = parseJsonMember(
        readTarMember(
            archivePath,
            members,
            licenseInputManifestName,
            runCommand,
            COMMAND_OUTPUT_MAX_BUFFER_BYTES
        ),
        licenseInputManifestName
    );
    const notices = parseJsonMember(
        readTarMember(
            archivePath,
            members,
            noticeManifestName,
            runCommand,
            COMMAND_OUTPUT_MAX_BUFFER_BYTES
        ),
        noticeManifestName
    );
    const noticeFile = sourceMemberRecord(
        archivePath,
        members,
        noticeFileName,
        runCommand,
        'THIRD_PARTY_NOTICES.txt'
    );
    return {
        libplaceboSourceSnapshot,
        licenseInputFiles: inspectLegalFiles(
            archivePath,
            members,
            runCommand,
            'license-inputs',
            ['linux-runtime-license-inputs.json']
        ),
        licenseInputs,
        noticeFile,
        noticeLicenseFiles: inspectLegalFiles(
            archivePath,
            members,
            runCommand,
            'notices',
            ['embedded-mpv-notices.json', 'THIRD_PARTY_NOTICES.txt']
        ),
        notices,
        toolingValidated: true,
    };
}

function parseArchiveChecksumRecords(contents) {
    const text = contents.toString('utf8');
    if (!text.endsWith('\n') || text.includes('\r')) {
        throw new Error(
            'Source archive checksum manifest must use canonical LF-terminated sha256sum records.'
        );
    }
    const lines = text.slice(0, -1).split('\n');
    const records = lines.map((line) => {
        const match = /^([a-f0-9]{64}) {2}([A-Za-z0-9_+.-]+)$/.exec(line);
        if (!match) {
            throw new Error(
                'Source archive checksum manifest contains an invalid record.'
            );
        }
        return {
            name: match[2],
            sha256: match[1],
        };
    });
    return normalizeArchiveRecords(records, 'Source archive checksum manifest');
}

function assertExactSourceArchiveLayout(members, archiveFiles, compliance) {
    const expectedFiles = new Set([
        ...archiveFiles.map(({ name }) => `archives/${name}`),
        ...SOURCE_TOOLING_FILES.map(({ archivePath }) => archivePath),
        'license-inputs/linux-runtime-license-inputs.json',
        ...compliance.licenseInputFiles.map(
            ({ path: relativePath }) => `license-inputs/${relativePath}`
        ),
        'metadata/archive-sha256.txt',
        'metadata/iptvnator-git-revision.txt',
        'metadata/local-changes.patch',
        'metadata/runtime-manifest.json',
        'metadata/source-index.json',
        'notices/THIRD_PARTY_NOTICES.txt',
        'notices/embedded-mpv-notices.json',
        ...compliance.noticeLicenseFiles.map(
            ({ path: relativePath }) => `notices/${relativePath}`
        ),
    ]);
    const expectedDirectories = new Set(['git']);
    for (const fileName of expectedFiles) {
        const parts = fileName.split('/');
        parts.pop();
        while (parts.length > 0) {
            expectedDirectories.add(parts.join('/'));
            parts.pop();
        }
    }

    const sourceRootName = 'git/libplacebo';
    for (const member of members.values()) {
        if (
            member.name === sourceRootName ||
            member.name.startsWith(`${sourceRootName}/`)
        ) {
            if (
                member.type === 'h' &&
                !member.linkTarget.startsWith(`${sourceRootName}/`)
            ) {
                throw new Error(
                    `Source archive hardlink leaves the libplacebo snapshot: ${member.name}`
                );
            }
            continue;
        }
        if (expectedFiles.has(member.name)) {
            if (member.type !== '-') {
                throw new Error(
                    `Canonical source archive file must be regular: ${member.name}`
                );
            }
            continue;
        }
        if (expectedDirectories.has(member.name)) {
            if (member.type !== 'd') {
                throw new Error(
                    `Canonical source archive directory has the wrong type: ${member.name}`
                );
            }
            continue;
        }
        throw new Error(
            `Source archive contains an undeclared source archive member: ${member.name}`
        );
    }

    for (const fileName of expectedFiles) {
        if (members.get(fileName)?.type !== '-') {
            throw new Error(
                `Source archive is missing canonical regular file: ${fileName}`
            );
        }
    }
    for (const directoryName of expectedDirectories) {
        if (members.get(directoryName)?.type !== 'd') {
            throw new Error(
                `Source archive is missing canonical directory: ${directoryName}`
            );
        }
    }
}

function inspectSourceArchive(
    archivePath,
    {
        expectedSourceSnapshotSha256 = EXPECTED_LIBPLACEBO_V7_360_1_SOURCE_SNAPSHOT_SHA256,
        runCommand = defaultRunCommand,
    } = {}
) {
    const archiveStat = fs.lstatSync(archivePath);
    if (
        !archiveStat.isFile() ||
        archiveStat.isSymbolicLink() ||
        archiveStat.size === 0 ||
        archiveStat.size > SOURCE_ARCHIVE_MAX_BYTES
    ) {
        throw new Error(
            'Linux source archive must be a bounded non-empty regular file.'
        );
    }
    const members = listTarMembers(archivePath, runCommand);
    const readMetadata = (memberName) =>
        readTarMember(
            archivePath,
            members,
            memberName,
            runCommand,
            COMMAND_OUTPUT_MAX_BUFFER_BYTES
        );
    const sourceRuntime = parseJsonMember(
        readMetadata('metadata/runtime-manifest.json'),
        'metadata/runtime-manifest.json'
    );
    const sourceIndex = parseJsonMember(
        readMetadata('metadata/source-index.json'),
        'metadata/source-index.json'
    );
    const repositoryRevision = readMetadata(
        'metadata/iptvnator-git-revision.txt'
    )
        .toString('utf8')
        .trim();
    const localChanges = readMetadata('metadata/local-changes.patch');
    const archiveMemberNames = [...members.values()]
        .filter(
            ({ isDirectory, name }) =>
                !isDirectory &&
                name.startsWith('archives/') &&
                name.split('/').length === 2
        )
        .map(({ name }) => name.slice('archives/'.length))
        .sort();
    const archiveFiles = archiveMemberNames.map((name) => ({
        name,
        sha256: crypto
            .createHash('sha256')
            .update(
                readTarMember(
                    archivePath,
                    members,
                    `archives/${name}`,
                    runCommand,
                    SOURCE_MEMBER_MAX_BUFFER_BYTES
                )
            )
            .digest('hex'),
    }));
    const archiveChecksums = parseArchiveChecksumRecords(
        readMetadata('metadata/archive-sha256.txt')
    );
    if (
        !isDeepStrictEqual(
            archiveChecksums,
            normalizeArchiveRecords(
                archiveFiles,
                'Source archive inspected archives'
            )
        )
    ) {
        throw new Error(
            'Source archive checksum manifest does not match the inspected archives.'
        );
    }
    const compliance = inspectSourceCompliance(
        archivePath,
        members,
        runCommand,
        expectedSourceSnapshotSha256
    );
    assertExactSourceArchiveLayout(members, archiveFiles, compliance);
    return {
        archiveSha256: sha256File(archivePath),
        archiveFiles,
        compliance,
        localChanges,
        repositoryRevision,
        sourceIndex,
        sourceRuntime,
    };
}

function readElfArchitecture(binaryPath) {
    const descriptor = fs.openSync(binaryPath, 'r');
    try {
        const header = Buffer.alloc(20);
        const bytesRead = fs.readSync(descriptor, header, 0, header.length, 0);
        if (
            bytesRead !== header.length ||
            header[0] !== 0x7f ||
            header[1] !== 0x45 ||
            header[2] !== 0x4c ||
            header[3] !== 0x46 ||
            ![1, 2].includes(header[4]) ||
            header[5] !== 1
        ) {
            throw new Error('Snap Electron executable is not a supported ELF.');
        }
        const machine = header.readUInt16LE(18);
        if (machine === 62 && header[4] === 2) {
            return 'x64';
        }
        if (machine === 183 && header[4] === 2) {
            return 'arm64';
        }
        if (machine === 40 && header[4] === 1) {
            return 'arm';
        }
        throw new Error(
            `Snap Electron executable uses unsupported ELF machine ${machine}.`
        );
    } finally {
        fs.closeSync(descriptor);
    }
}

function collectSnapNativePayloads(extractionRoot) {
    const candidates = [];
    const pendingDirectories = [extractionRoot];
    let entryCount = 0;
    while (pendingDirectories.length > 0) {
        const directoryPath = pendingDirectories.pop();
        const entries = fs
            .readdirSync(directoryPath, { withFileTypes: true })
            .sort(({ name: left }, { name: right }) =>
                left.localeCompare(right)
            );
        for (const entry of entries) {
            entryCount += 1;
            if (entryCount > SNAP_PAYLOAD_ENTRY_LIMIT) {
                throw new Error(
                    'Extracted Snap exceeds the release-verifier entry limit.'
                );
            }
            const entryPath = path.join(directoryPath, entry.name);
            if (entry.isDirectory()) {
                pendingDirectories.push(entryPath);
                continue;
            }
            if (
                !entry.isFile() ||
                ![
                    FRAME_COPY_MANIFEST_NAME,
                    FRAME_COPY_UNAVAILABLE_MARKER_NAME,
                ].includes(entry.name)
            ) {
                continue;
            }
            const relativePath = path
                .relative(extractionRoot, entryPath)
                .split(path.sep)
                .join('/');
            const expectedSuffix = `${NATIVE_PAYLOAD_SUFFIX}/${entry.name}`;
            if (
                relativePath === expectedSuffix ||
                relativePath.endsWith(`/${expectedSuffix}`)
            ) {
                candidates.push(entryPath);
            }
        }
    }
    return candidates;
}

function inspectSquashfsListing(snapPath, runCommand) {
    const listing = runCommand('unsquashfs', ['-lln', snapPath], {
        encoding: 'utf8',
        maxBuffer: SQUASHFS_LIST_MAX_BUFFER_BYTES,
        timeout: COMMAND_TIMEOUT_MS,
    });
    if (typeof listing !== 'string') {
        throw new Error('Unable to inspect the Snap filesystem listing.');
    }
    let entryCount = 0;
    let extractedBytes = 0;
    for (const line of listing.split(/\r?\n/).filter(Boolean)) {
        const match =
            /^([bcdlps-])\S*\s+\d+\/\d+\s+(\d+)\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s+.+$/.exec(
                line
            );
        if (!match || !['-', 'd', 'l'].includes(match[1])) {
            throw new Error(
                'Snap filesystem listing contains an invalid entry.'
            );
        }
        entryCount += 1;
        if (entryCount > SNAP_PAYLOAD_ENTRY_LIMIT) {
            throw new Error('Snap exceeds the release-verifier entry limit.');
        }
        if (match[1] === '-') {
            extractedBytes += Number(match[2]);
            if (
                !Number.isSafeInteger(extractedBytes) ||
                extractedBytes > SNAP_EXTRACTED_MAX_BYTES
            ) {
                throw new Error(
                    'Snap exceeds the release-verifier extracted-size limit.'
                );
            }
        }
    }
    if (entryCount === 0) {
        throw new Error('Snap filesystem listing must not be empty.');
    }
}

function inspectSnapPayload(
    snapPath,
    asset,
    {
        runCommand = defaultRunCommand,
        validatePackagedEmbeddedMpv:
            validatePackaged = validatePackagedEmbeddedMpv,
    } = {}
) {
    const snapStat = fs.lstatSync(snapPath);
    if (
        !snapStat.isFile() ||
        snapStat.isSymbolicLink() ||
        snapStat.size === 0 ||
        snapStat.size > SNAP_ARCHIVE_MAX_BYTES
    ) {
        throw new Error(
            `Snap ${asset.name} must be a bounded non-empty regular file.`
        );
    }
    inspectSquashfsListing(snapPath, runCommand);
    const temporaryRoot = fs.mkdtempSync(
        path.join(os.tmpdir(), 'iptvnator-snap-source-verifier-')
    );
    try {
        const extractionRoot = path.join(temporaryRoot, 'payload');
        runCommand(
            'unsquashfs',
            ['-no-progress', '-dest', extractionRoot, snapPath],
            {
                encoding: 'utf8',
                maxBuffer: COMMAND_OUTPUT_MAX_BUFFER_BYTES,
                timeout: COMMAND_TIMEOUT_MS,
            }
        );
        const payloads = collectSnapNativePayloads(extractionRoot);
        const canonicalNativeDirectory = path.join(
            extractionRoot,
            'usr',
            'lib',
            'iptvnator',
            'resources',
            'app.asar.unpacked',
            'electron-backend',
            'native'
        );
        const canonicalPayloads = [
            FRAME_COPY_MANIFEST_NAME,
            FRAME_COPY_UNAVAILABLE_MARKER_NAME,
        ]
            .map((name) => path.join(canonicalNativeDirectory, name))
            .filter((candidate) => payloads.includes(candidate));
        if (
            payloads.length !== 1 ||
            canonicalPayloads.length !== 1 ||
            payloads[0] !== canonicalPayloads[0]
        ) {
            throw new Error(
                `Snap ${asset.name} must contain exactly one canonical frame-copy manifest or unavailable marker.`
            );
        }
        const payloadPath = canonicalPayloads[0];
        const resourcesDirectory = path.join(
            extractionRoot,
            'usr',
            'lib',
            'iptvnator',
            'resources'
        );
        const electronPath = path.join(
            extractionRoot,
            'usr',
            'lib',
            'iptvnator',
            'iptvnator.bin'
        );
        const electronStat = fs.lstatSync(electronPath);
        if (
            !electronStat.isFile() ||
            electronStat.isSymbolicLink() ||
            electronStat.size < 20
        ) {
            throw new Error(
                `Snap ${asset.name} is missing its regular Electron executable.`
            );
        }
        const architecture = readElfArchitecture(electronPath);
        if (path.basename(payloadPath) === FRAME_COPY_MANIFEST_NAME) {
            const manifestStat = fs.lstatSync(payloadPath);
            if (
                !manifestStat.isFile() ||
                manifestStat.isSymbolicLink() ||
                manifestStat.size === 0 ||
                manifestStat.size > COMMAND_OUTPUT_MAX_BUFFER_BYTES
            ) {
                throw new Error(
                    `Snap ${asset.name} contains an invalid frame-copy manifest.`
                );
            }
        }
        const staticErrors = validatePackaged(resourcesDirectory, {
            artifactFormat: 'snap',
            executableName: 'iptvnator',
            foreignArch: architecture !== 'x64',
            hostPlatform: 'linux',
            platform: 'linux',
            profile: 'portable',
            required: true,
            targetArch: architecture,
            targetNames: ['appimage', 'snap'],
        });
        if (!Array.isArray(staticErrors) || staticErrors.length > 0) {
            throw new Error(
                `Snap ${asset.name} failed static frame-copy validation${
                    Array.isArray(staticErrors) && staticErrors.length > 0
                        ? `: ${staticErrors.join('; ')}`
                        : '.'
                }`
            );
        }
        if (path.basename(payloadPath) === FRAME_COPY_UNAVAILABLE_MARKER_NAME) {
            return {
                architecture,
                assetName: asset.name,
                manifest: null,
                markerOnly: true,
            };
        }
        let manifest;
        try {
            manifest = JSON.parse(fs.readFileSync(payloadPath, 'utf8'));
        } catch {
            throw new Error(
                `Snap ${asset.name} contains malformed frame-copy manifest JSON.`
            );
        }
        return {
            architecture,
            assetName: asset.name,
            manifest,
            markerOnly: false,
        };
    } finally {
        fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
}

function normalizeArchiveRecords(records, label) {
    if (!Array.isArray(records) || records.length === 0) {
        throw new Error(`${label} must contain source archive checksums.`);
    }
    const normalized = records.map((record) => {
        if (
            !isObject(record) ||
            !isDeepStrictEqual(Object.keys(record).sort(), [
                'name',
                'sha256',
            ]) ||
            typeof record.name !== 'string' ||
            !SAFE_BASENAME_PATTERN.test(record.name) ||
            typeof record.sha256 !== 'string' ||
            !SHA256_PATTERN.test(record.sha256)
        ) {
            throw new Error(`${label} contains an invalid archive record.`);
        }
        return {
            name: record.name,
            sha256: record.sha256,
        };
    });
    const names = normalized.map(({ name }) => name);
    const hashes = normalized.map(({ sha256 }) => sha256);
    if (
        new Set(names).size !== names.length ||
        new Set(hashes).size !== hashes.length
    ) {
        throw new Error(`${label} contains duplicate archive records.`);
    }
    return normalized.sort(({ name: left }, { name: right }) =>
        left.localeCompare(right)
    );
}

function hasExactFields(value, fields) {
    return (
        isObject(value) &&
        isDeepStrictEqual(Object.keys(value).sort(), [...fields].sort())
    );
}

function safeRelativePath(value) {
    return (
        typeof value === 'string' &&
        value.length > 0 &&
        !value.includes('\\') &&
        !path.posix.isAbsolute(value) &&
        value
            .split('/')
            .every(
                (part) =>
                    part !== '' &&
                    part !== '.' &&
                    part !== '..' &&
                    SAFE_BASENAME_PATTERN.test(part)
            )
    );
}

function normalizeLegalFileRecords(records, label) {
    if (!Array.isArray(records) || records.length === 0) {
        throw new Error(`${label} must contain legal files.`);
    }
    const normalized = records.map((record) => {
        if (
            !hasExactFields(record, ['path', 'sha256', 'size']) ||
            !safeRelativePath(record.path) ||
            !record.path.startsWith('licenses/') ||
            !Number.isSafeInteger(record.size) ||
            record.size <= 0 ||
            typeof record.sha256 !== 'string' ||
            !SHA256_PATTERN.test(record.sha256)
        ) {
            throw new Error(`${label} contains an invalid legal file.`);
        }
        return { ...record };
    });
    const paths = normalized.map(({ path: filePath }) => filePath);
    if (new Set(paths).size !== paths.length) {
        throw new Error(`${label} contains duplicate legal files.`);
    }
    return normalized.sort(({ path: left }, { path: right }) =>
        left.localeCompare(right)
    );
}

function sourcePackageLegalIdentity(sourcePackage) {
    return Object.fromEntries(
        [
            'version',
            'sourceUrl',
            'sourceTag',
            'sourceSha256',
            'sourceGitCommit',
            'license',
        ]
            .filter((field) => Object.hasOwn(sourcePackage, field))
            .map((field) => [field, sourcePackage[field]])
    );
}

function verifySourceArchiveCompliance({
    compliance,
    sourceIndex,
    sourceRuntime,
}) {
    if (
        !hasExactFields(compliance, [
            'libplaceboSourceSnapshot',
            'licenseInputFiles',
            'licenseInputs',
            'noticeFile',
            'noticeLicenseFiles',
            'notices',
            'toolingValidated',
        ]) ||
        compliance.toolingValidated !== true
    ) {
        throw new Error('Source archive compliance payload is incomplete.');
    }
    const { licenseInputs, notices } = compliance;
    if (
        !hasExactFields(licenseInputs, [
            'schemaVersion',
            'origin',
            'platform',
            'arch',
            'packages',
        ]) ||
        licenseInputs.schemaVersion !== 1 ||
        licenseInputs.origin !== 'pinned-linux-runtime-license-inputs' ||
        licenseInputs.platform !== 'linux' ||
        licenseInputs.arch !== 'x64' ||
        !Array.isArray(licenseInputs.packages) ||
        !hasExactFields(notices, [
            'schemaVersion',
            'origin',
            'platform',
            'arch',
            'noticeFile',
            'packages',
            'totalBytes',
        ]) ||
        notices.schemaVersion !== 1 ||
        notices.origin !== 'pinned-linux-runtime-upstream-licenses' ||
        notices.platform !== 'linux' ||
        notices.arch !== 'x64' ||
        !Array.isArray(notices.packages)
    ) {
        throw new Error('Source archive compliance manifests are invalid.');
    }
    const runtimePackages = sourceRuntime.packages;
    const runtimePackageIds = Object.keys(runtimePackages).sort();
    const inputPackages = new Map(
        licenseInputs.packages.map((record) => [record?.id, record])
    );
    const noticePackages = new Map(
        notices.packages.map((record) => [record?.id, record])
    );
    if (
        inputPackages.size !== licenseInputs.packages.length ||
        noticePackages.size !== notices.packages.length ||
        !isDeepStrictEqual(
            [...inputPackages.keys()].sort(),
            runtimePackageIds
        ) ||
        !isDeepStrictEqual([...noticePackages.keys()].sort(), runtimePackageIds)
    ) {
        throw new Error(
            'Source archive legal package set does not match the runtime.'
        );
    }
    const declaredLegalFiles = [];
    for (const packageId of runtimePackageIds) {
        if (!SAFE_BASENAME_PATTERN.test(packageId)) {
            throw new Error(
                'Source archive runtime contains an unsafe package id.'
            );
        }
        const identity = sourcePackageLegalIdentity(runtimePackages[packageId]);
        const inputPackage = inputPackages.get(packageId);
        const noticePackage = noticePackages.get(packageId);
        if (
            !hasExactFields(inputPackage, [
                'id',
                ...Object.keys(identity),
                'files',
            ]) ||
            !hasExactFields(noticePackage, [
                'id',
                ...Object.keys(identity),
                'files',
            ]) ||
            !Object.entries(identity).every(
                ([field, value]) =>
                    isDeepStrictEqual(inputPackage[field], value) &&
                    isDeepStrictEqual(noticePackage[field], value)
            ) ||
            !Array.isArray(inputPackage.files) ||
            !Array.isArray(noticePackage.files) ||
            inputPackage.files.length === 0 ||
            inputPackage.files.length !== noticePackage.files.length
        ) {
            throw new Error(
                `Source archive legal identity is invalid for ${packageId}.`
            );
        }
        const inputFiles = inputPackage.files
            .map((record) => {
                if (
                    !hasExactFields(record, [
                        'sourcePath',
                        'path',
                        'size',
                        'sha256',
                    ]) ||
                    !safeRelativePath(record.sourcePath) ||
                    record.path !== `licenses/${packageId}/${record.sourcePath}`
                ) {
                    throw new Error(
                        `Source archive license input is invalid for ${packageId}.`
                    );
                }
                return {
                    path: record.path,
                    sha256: record.sha256,
                    size: record.size,
                };
            })
            .sort(({ path: left }, { path: right }) =>
                left.localeCompare(right)
            );
        const noticeFiles = normalizeLegalFileRecords(
            noticePackage.files,
            `Source archive notices for ${packageId}`
        );
        const normalizedInputFiles = normalizeLegalFileRecords(
            inputFiles,
            `Source archive license inputs for ${packageId}`
        );
        if (!isDeepStrictEqual(normalizedInputFiles, noticeFiles)) {
            throw new Error(
                `Source archive legal files diverge for ${packageId}.`
            );
        }
        declaredLegalFiles.push(...noticeFiles);
    }
    const normalizedDeclaredFiles = normalizeLegalFileRecords(
        declaredLegalFiles,
        'Source archive declared legal files'
    );
    if (
        !isDeepStrictEqual(
            normalizeLegalFileRecords(
                compliance.licenseInputFiles,
                'Source archive license input contents'
            ),
            normalizedDeclaredFiles
        ) ||
        !isDeepStrictEqual(
            normalizeLegalFileRecords(
                compliance.noticeLicenseFiles,
                'Source archive notice contents'
            ),
            normalizedDeclaredFiles
        )
    ) {
        throw new Error(
            'Source archive legal contents do not match their manifests.'
        );
    }
    if (
        !hasExactFields(compliance.noticeFile, ['path', 'sha256', 'size']) ||
        compliance.noticeFile.path !== 'THIRD_PARTY_NOTICES.txt' ||
        !Number.isSafeInteger(compliance.noticeFile.size) ||
        compliance.noticeFile.size <= 0 ||
        !SHA256_PATTERN.test(compliance.noticeFile.sha256) ||
        !isDeepStrictEqual(notices.noticeFile, compliance.noticeFile) ||
        notices.totalBytes !==
            compliance.noticeFile.size +
                normalizedDeclaredFiles.reduce(
                    (total, file) => total + file.size,
                    0
                )
    ) {
        throw new Error('Source archive aggregate notices are invalid.');
    }
    if (
        !isDeepStrictEqual(sourceIndex.legal, {
            manifest: 'notices/embedded-mpv-notices.json',
            noticeFile: notices.noticeFile,
            packages: notices.packages,
        })
    ) {
        throw new Error(
            'Source archive legal index does not match its notices.'
        );
    }
}

function verifySnapReleaseSourceBinding(
    { expectedRepositoryRevision, sourceInspection, snapPayloads },
    {
        expectedSourceSnapshotSha256 = EXPECTED_LIBPLACEBO_V7_360_1_SOURCE_SNAPSHOT_SHA256,
        validateRuntimeManifest = validateLinuxRuntimeManifest,
    } = {}
) {
    if (
        typeof expectedRepositoryRevision !== 'string' ||
        !GIT_COMMIT_PATTERN.test(expectedRepositoryRevision)
    ) {
        throw new Error(
            'Expected release repository revision must be a full Git commit.'
        );
    }
    if (!isObject(sourceInspection)) {
        throw new Error('Source archive inspection is missing.');
    }
    const {
        archiveFiles,
        archiveSha256,
        compliance,
        localChanges,
        repositoryRevision,
        sourceIndex,
        sourceRuntime,
    } = sourceInspection;
    const runtimeErrors = validateRuntimeManifest(sourceRuntime);
    if (!Array.isArray(runtimeErrors) || runtimeErrors.length > 0) {
        throw new Error(
            `Source archive runtime manifest is invalid${
                Array.isArray(runtimeErrors) && runtimeErrors.length > 0
                    ? `: ${runtimeErrors.join('; ')}`
                    : '.'
            }`
        );
    }
    if (
        repositoryRevision !== expectedRepositoryRevision ||
        !isObject(sourceIndex) ||
        sourceIndex.repositoryRevision !== expectedRepositoryRevision
    ) {
        throw new Error(
            'Source archive repository revision does not match the released tag.'
        );
    }
    const expectedSourceArchiveBinding = {
        schemaVersion: SOURCE_ARCHIVE_BINDING_SCHEMA_VERSION,
        name: SOURCE_ARCHIVE_NAME,
        sha256: archiveSha256,
        repositoryRevision,
    };
    const sourceArchiveBindingErrors = validateLinuxSourceArchiveBinding(
        expectedSourceArchiveBinding,
        {
            expectedRepositoryRevision,
            expectedSha256: archiveSha256,
        }
    );
    if (sourceArchiveBindingErrors.length > 0) {
        throw new Error(
            `Source archive byte binding is invalid: ${sourceArchiveBindingErrors.join(
                '; '
            )}`
        );
    }
    const localChangesLength =
        typeof localChanges === 'string'
            ? Buffer.byteLength(localChanges)
            : localChanges instanceof Uint8Array
              ? localChanges.byteLength
              : -1;
    if (localChangesLength !== 0) {
        throw new Error(
            'Source archive must describe a clean released repository revision.'
        );
    }
    if (
        sourceIndex.schemaVersion !== SOURCE_INDEX_SCHEMA_VERSION ||
        !isDeepStrictEqual(Object.keys(sourceIndex).sort(), [
            'archives',
            'legal',
            'libplacebo',
            'repositoryRevision',
            'schemaVersion',
            'sourcePackages',
        ]) ||
        !isObject(sourceIndex.legal) ||
        !isDeepStrictEqual(sourceIndex.sourcePackages, sourceRuntime.packages)
    ) {
        throw new Error(
            'Source archive index does not match its runtime manifest.'
        );
    }
    verifySourceArchiveCompliance({
        compliance,
        sourceIndex,
        sourceRuntime,
    });
    const libplaceboPackage = sourceRuntime.packages?.libplacebo;
    const sourceSnapshot = validateLinuxRuntimeSourceSnapshot(
        compliance.libplaceboSourceSnapshot,
        {
            expectedSha256: expectedSourceSnapshotSha256,
        }
    );
    const expectedLibplaceboRecord = {
        sourceGitCommit: libplaceboPackage?.sourceGitCommit,
        sourceSubmodules: [...EXPECTED_LIBPLACEBO_V7_360_1_SOURCE_SUBMODULES],
        sourceSnapshot,
    };
    if (
        !isDeepStrictEqual(
            libplaceboPackage?.sourceSubmodules,
            EXPECTED_LIBPLACEBO_V7_360_1_SOURCE_SUBMODULES
        )
    ) {
        throw new Error(
            'Source archive libplacebo submodule records do not match the pinned source identity.'
        );
    }
    if (
        !GIT_COMMIT_PATTERN.test(
            expectedLibplaceboRecord.sourceGitCommit ?? ''
        ) ||
        !isDeepStrictEqual(sourceIndex.libplacebo, expectedLibplaceboRecord)
    ) {
        throw new Error(
            'Source archive libplacebo identity does not match its runtime manifest.'
        );
    }
    const indexedArchives = normalizeArchiveRecords(
        sourceIndex.archives,
        'Source archive index'
    );
    const inspectedArchives = normalizeArchiveRecords(
        archiveFiles,
        'Source archive contents'
    );
    if (!isDeepStrictEqual(inspectedArchives, indexedArchives)) {
        throw new Error(
            'Source archive checksums do not match its source index.'
        );
    }
    const expectedArchiveHashes = Object.values(sourceRuntime.packages ?? {})
        .filter(
            (sourcePackage) =>
                isObject(sourcePackage) &&
                Object.hasOwn(sourcePackage, 'sourceSha256')
        )
        .map((sourcePackage) => sourcePackage.sourceSha256)
        .sort();
    const indexedArchiveHashes = indexedArchives
        .map(({ sha256 }) => sha256)
        .sort();
    if (
        expectedArchiveHashes.length === 0 ||
        expectedArchiveHashes.some(
            (sha256) =>
                typeof sha256 !== 'string' || !SHA256_PATTERN.test(sha256)
        ) ||
        new Set(expectedArchiveHashes).size !== expectedArchiveHashes.length ||
        !isDeepStrictEqual(indexedArchiveHashes, expectedArchiveHashes)
    ) {
        throw new Error(
            'Source archive checksums do not match the pinned runtime packages.'
        );
    }
    if (!Array.isArray(snapPayloads) || snapPayloads.length === 0) {
        throw new Error('Every selected Snap must be inspected.');
    }
    const assetNames = new Set();
    let x64SnapCount = 0;
    for (const payload of snapPayloads) {
        if (
            !isObject(payload) ||
            typeof payload.assetName !== 'string' ||
            payload.assetName.length === 0 ||
            assetNames.has(payload.assetName)
        ) {
            throw new Error('Selected Snap inspections must be unique.');
        }
        assetNames.add(payload.assetName);
        if (payload.architecture === 'x64') {
            x64SnapCount += 1;
            if (payload.markerOnly !== false || !isObject(payload.manifest)) {
                throw new Error(
                    `x64 Snap ${payload.assetName} must contain the frame-copy runtime.`
                );
            }
            const manifest = payload.manifest;
            if (
                manifest.platform !== 'linux' ||
                manifest.arch !== 'x64' ||
                manifest.profile !== 'portable' ||
                manifest.runtimeMode !== 'bundled' ||
                !Array.isArray(manifest.targets) ||
                !manifest.targets.includes('snap') ||
                !isDeepStrictEqual(
                    manifest.sourceArchive,
                    expectedSourceArchiveBinding
                )
            ) {
                throw new Error(
                    `x64 Snap ${payload.assetName} has an invalid frame-copy source archive binding.`
                );
            }
            if (!isDeepStrictEqual(manifest.sourceRuntime, sourceRuntime)) {
                throw new Error(
                    `Snap source runtime does not match source archive: ${payload.assetName}`
                );
            }
            continue;
        }
        if (
            !['arm', 'arm64'].includes(payload.architecture) ||
            payload.markerOnly !== true ||
            payload.manifest !== null
        ) {
            throw new Error(
                `Non-x64 Snap ${payload.assetName} must remain marker-only.`
            );
        }
    }
    if (x64SnapCount !== 1) {
        throw new Error(
            `Public release must contain exactly one x64 Snap; received ${x64SnapCount}.`
        );
    }
    return true;
}

module.exports = {
    inspectSnapPayload,
    inspectSourceArchive,
    verifySnapReleaseSourceBinding,
};
