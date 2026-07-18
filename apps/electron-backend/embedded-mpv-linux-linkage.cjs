'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const VERSIONED_LIBMPV_PATTERN = /^libmpv\.so\.\d+(?:\.\d+)*$/;
const LIBMPV_NEEDED_PATTERN = /^libmpv\.so(?:\..*)?$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

const LINUX_FRAME_COPY_ARTIFACTS = Object.freeze([
    Object.freeze({
        fileName: 'embedded_mpv.node',
        label: 'embedded MPV addon',
        mayLinkLibmpv: false,
    }),
    Object.freeze({
        fileName: 'embedded_mpv_frame_reader.node',
        label: 'embedded MPV frame reader',
        mayLinkLibmpv: false,
    }),
    Object.freeze({
        fileName: 'iptvnator_mpv_helper',
        label: 'embedded MPV frame-copy helper',
        mayLinkLibmpv: true,
    }),
]);

function parseReadelfDynamic(output) {
    if (typeof output !== 'string') {
        throw new TypeError('readelf dynamic output must be a string.');
    }

    const dynamic = {
        needed: [],
        rpath: [],
        runpath: [],
        soname: [],
    };
    const dynamicEntryPattern =
        /\((NEEDED|RPATH|RUNPATH|SONAME)\)[^[]*\[([^\]]*)\]/g;
    for (const [, tag, value] of output.matchAll(dynamicEntryPattern)) {
        if (tag === 'NEEDED') {
            dynamic.needed.push(value);
            continue;
        }
        if (tag === 'SONAME') {
            dynamic.soname.push(value);
            continue;
        }
        dynamic[tag.toLowerCase()].push(
            ...value.split(':').filter((entry) => entry.length > 0)
        );
    }

    return dynamic;
}

function exactlyOneRuntimeFile(runtimeFiles, name) {
    if (!Array.isArray(runtimeFiles)) {
        throw new Error('Linux runtimeFiles metadata must be an array.');
    }
    const matchingRecords = runtimeFiles.filter(
        (runtimeFile) => runtimeFile?.name === name
    );
    if (matchingRecords.length !== 1) {
        throw new Error(
            `Linux runtime must contain exactly one exact runtimeFiles record for ${name}.`
        );
    }

    const [runtimeFile] = matchingRecords;
    if (
        !Number.isInteger(runtimeFile.size) ||
        runtimeFile.size <= 0 ||
        typeof runtimeFile.sha256 !== 'string' ||
        !SHA256_PATTERN.test(runtimeFile.sha256)
    ) {
        throw new Error(
            `Linux runtimeFiles record for ${name} has invalid size or SHA-256 metadata.`
        );
    }
    return runtimeFile;
}

function readVerifiedRuntimeFile(filePath, runtimeFile) {
    let stat;
    try {
        stat = fs.lstatSync(filePath);
    } catch {
        throw new Error(`Missing copied Linux runtime file: ${filePath}`);
    }
    if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new Error(
            `Copied Linux runtime file must be a regular non-symbolic-link file: ${filePath}`
        );
    }

    let descriptor;
    try {
        descriptor = fs.openSync(
            filePath,
            fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0)
        );
        const descriptorStat = fs.fstatSync(descriptor);
        if (!descriptorStat.isFile()) {
            throw new Error(
                `Copied Linux runtime path is not a regular file: ${filePath}`
            );
        }
        const contents = fs.readFileSync(descriptor);
        if (contents.byteLength !== runtimeFile.size) {
            throw new Error(
                `Size mismatch for copied Linux runtime file ${runtimeFile.name}: expected ${runtimeFile.size}, received ${contents.byteLength}.`
            );
        }
        const actualSha256 = crypto
            .createHash('sha256')
            .update(contents)
            .digest('hex');
        if (actualSha256 !== runtimeFile.sha256) {
            throw new Error(
                `SHA-256 mismatch for copied Linux runtime file ${runtimeFile.name}: expected ${runtimeFile.sha256}, received ${actualSha256}.`
            );
        }
    } finally {
        if (descriptor !== undefined) {
            fs.closeSync(descriptor);
        }
    }
}

function closureLibMpvSoname(runtimeDependencyClosure) {
    if (!Array.isArray(runtimeDependencyClosure?.entries)) {
        throw new Error(
            'Validated Linux runtime dependency closure entries are required.'
        );
    }

    const libMpvEntries = runtimeDependencyClosure.entries.filter(
        (entry) =>
            entry?.name === 'libmpv.so' ||
            VERSIONED_LIBMPV_PATTERN.test(entry?.name)
    );
    const declaredSonames = libMpvEntries.map((entry) => entry.soname);
    const uniqueSonames = new Set(declaredSonames);
    if (
        declaredSonames.length === 0 ||
        declaredSonames.some(
            (soname) =>
                typeof soname !== 'string' ||
                !VERSIONED_LIBMPV_PATTERN.test(soname)
        ) ||
        uniqueSonames.size !== 1
    ) {
        throw new Error(
            'Validated Linux runtime closure must declare exactly one versioned libmpv SONAME.'
        );
    }

    return declaredSonames[0];
}

function resolveVerifiedLinuxLibMpvSoname({
    outputLibDir,
    runtimeFiles,
    runtimeDependencyClosure,
    readDynamicSection,
}) {
    if (typeof readDynamicSection !== 'function') {
        throw new TypeError('Linux readelf dynamic reader is required.');
    }

    const expectedSoname = closureLibMpvSoname(runtimeDependencyClosure);
    const linkerInputRecord = exactlyOneRuntimeFile(runtimeFiles, 'libmpv.so');
    const exactSonameRecord = exactlyOneRuntimeFile(
        runtimeFiles,
        expectedSoname
    );
    const linkerInputPath = path.join(outputLibDir, 'libmpv.so');
    const exactSonamePath = path.join(outputLibDir, expectedSoname);

    readVerifiedRuntimeFile(linkerInputPath, linkerInputRecord);
    readVerifiedRuntimeFile(exactSonamePath, exactSonameRecord);

    const dynamic = parseReadelfDynamic(readDynamicSection(linkerInputPath));
    if (
        dynamic.soname.length !== 1 ||
        !VERSIONED_LIBMPV_PATTERN.test(dynamic.soname[0])
    ) {
        throw new Error(
            'Copied Linux libmpv.so must contain exactly one DT_SONAME with a versioned libmpv basename.'
        );
    }
    if (dynamic.soname[0] !== expectedSoname) {
        throw new Error(
            `Copied Linux libmpv.so DT_SONAME ${dynamic.soname[0]} does not match validated closure SONAME ${expectedSoname}.`
        );
    }

    return expectedSoname;
}

function resolveLinuxFrameCopyLinkageInputs({
    buildInputMode,
    outputLibDir,
    packagedLibmpvSoname,
    readDynamicSection,
    runtimeLibDir,
}) {
    const systemDevelopment = buildInputMode === 'system-dev';
    const linkerLibraryDir = systemDevelopment ? runtimeLibDir : outputLibDir;
    if (
        typeof linkerLibraryDir !== 'string' ||
        linkerLibraryDir.trim().length === 0
    ) {
        throw new Error(
            'Linux frame-copy linkage requires a non-empty linker library directory.'
        );
    }

    if (!systemDevelopment) {
        return {
            expectedLibmpvSoname: packagedLibmpvSoname,
            linkerLibraryDir,
        };
    }
    if (typeof readDynamicSection !== 'function') {
        throw new TypeError('Linux readelf dynamic reader is required.');
    }

    const linkerInputPath = path.join(linkerLibraryDir, 'libmpv.so');
    const dynamic = parseReadelfDynamic(readDynamicSection(linkerInputPath));
    if (
        dynamic.soname.length !== 1 ||
        !VERSIONED_LIBMPV_PATTERN.test(dynamic.soname[0])
    ) {
        throw new Error(
            'The system-development libmpv linker input must contain exactly one versioned libmpv SONAME.'
        );
    }

    return {
        expectedLibmpvSoname: dynamic.soname[0],
        linkerLibraryDir,
    };
}

function assertRegularArtifact(filePath, label) {
    let stat;
    try {
        stat = fs.lstatSync(filePath);
    } catch {
        throw new Error(`Missing ${label}: ${filePath}`);
    }
    if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new Error(
            `${label} must be a regular non-symbolic-link file: ${filePath}`
        );
    }
}

function validateLinuxFrameCopyLinkage({
    expectedLibmpvSoname,
    outputDir,
    readDynamicSection,
}) {
    if (
        typeof expectedLibmpvSoname !== 'string' ||
        !VERSIONED_LIBMPV_PATTERN.test(expectedLibmpvSoname)
    ) {
        throw new Error(
            'Linux frame-copy linkage validation requires an exact versioned libmpv SONAME.'
        );
    }
    if (typeof readDynamicSection !== 'function') {
        throw new TypeError('Linux readelf dynamic reader is required.');
    }

    for (const artifact of LINUX_FRAME_COPY_ARTIFACTS) {
        const artifactPath = path.join(outputDir, artifact.fileName);
        assertRegularArtifact(artifactPath, artifact.label);
        const dynamic = parseReadelfDynamic(readDynamicSection(artifactPath));
        const libMpvDependencies = dynamic.needed.filter((dependency) =>
            LIBMPV_NEEDED_PATTERN.test(dependency)
        );

        if (!artifact.mayLinkLibmpv) {
            if (libMpvDependencies.length > 0) {
                throw new Error(
                    `${artifact.label} must not have a direct libmpv DT_NEEDED entry; found ${libMpvDependencies.join(', ')}.`
                );
            }
            continue;
        }

        if (
            libMpvDependencies.length !== 1 ||
            libMpvDependencies[0] !== expectedLibmpvSoname
        ) {
            throw new Error(
                `${artifact.label} DT_NEEDED must contain exactly ${expectedLibmpvSoname}; found ${
                    libMpvDependencies.join(', ') || '<none>'
                }.`
            );
        }
        if (dynamic.rpath.length !== 0) {
            throw new Error(
                `${artifact.label} must not contain RPATH; found ${dynamic.rpath.join(':')}.`
            );
        }
        if (
            dynamic.runpath.length !== 1 ||
            dynamic.runpath[0] !== '$ORIGIN/lib'
        ) {
            throw new Error(
                `${artifact.label} RUNPATH must be exactly $ORIGIN/lib; found ${
                    dynamic.runpath.join(':') || '<none>'
                }.`
            );
        }
    }
}

function runWithCleanup(operation, cleanup) {
    try {
        return operation();
    } catch (error) {
        cleanup();
        throw error;
    }
}

module.exports = {
    parseReadelfDynamic,
    resolveLinuxFrameCopyLinkageInputs,
    resolveVerifiedLinuxLibMpvSoname,
    runWithCleanup,
    validateLinuxFrameCopyLinkage,
};
