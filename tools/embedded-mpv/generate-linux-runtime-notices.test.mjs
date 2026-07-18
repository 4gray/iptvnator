import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { SOURCE_PACKAGES } = require('./build-linux-runtime.cjs');
const {
    LICENSE_PATHS_BY_PACKAGE,
    collectLinuxRuntimeLicenseInputs,
    generateLinuxRuntimeNotices,
    validateLinuxRuntimeNotices,
} = require('./generate-linux-runtime-notices.cjs');
const generatorScript = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    'generate-linux-runtime-notices.cjs'
);

function runtimeManifest() {
    return {
        platform: 'linux',
        arch: 'x64',
        packages: Object.fromEntries(
            SOURCE_PACKAGES.map((sourcePackage) => [
                sourcePackage.id,
                {
                    version: sourcePackage.version,
                    sourceUrl: sourcePackage.sourceUrl,
                    ...(sourcePackage.sourceTag
                        ? { sourceTag: sourcePackage.sourceTag }
                        : {}),
                    ...(sourcePackage.sourceKind === 'archive'
                        ? { sourceSha256: sourcePackage.expectedSha256 }
                        : {
                              sourceGitCommit: sourcePackage.expectedGitCommit,
                              sourceSubmodules: [
                                  ...sourcePackage.expectedSubmodules,
                              ],
                          }),
                    license: sourcePackage.license,
                    ...(sourcePackage.buildInput
                        ? { buildInput: sourcePackage.buildInput }
                        : {}),
                },
            ])
        ),
    };
}

function createSourceFixture() {
    const root = fs.mkdtempSync(
        path.join(os.tmpdir(), 'iptvnator-linux-license-sources-')
    );
    for (const sourcePackage of SOURCE_PACKAGES) {
        const licensePaths = LICENSE_PATHS_BY_PACKAGE[sourcePackage.id];
        assert.ok(
            Array.isArray(licensePaths) && licensePaths.length > 0,
            `missing test mapping for ${sourcePackage.id}`
        );
        for (const relativePath of licensePaths) {
            const filePath = path.join(root, sourcePackage.id, relativePath);
            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            fs.writeFileSync(
                filePath,
                `verbatim upstream ${sourcePackage.id} ${relativePath}\n`
            );
        }
    }
    return root;
}

function fileTree(root) {
    const files = [];
    function visit(directoryPath) {
        for (const entry of fs
            .readdirSync(directoryPath, { withFileTypes: true })
            .sort((left, right) => left.name.localeCompare(right.name))) {
            const entryPath = path.join(directoryPath, entry.name);
            if (entry.isDirectory()) {
                visit(entryPath);
            } else {
                files.push({
                    path: path
                        .relative(root, entryPath)
                        .split(path.sep)
                        .join('/'),
                    contents: fs.readFileSync(entryPath),
                });
            }
        }
    }
    visit(root);
    return files;
}

test('collects verbatim pinned licenses and generates deterministic exact notices', (t) => {
    const sourceRoot = createSourceFixture();
    const fixtureRoot = fs.mkdtempSync(
        path.join(os.tmpdir(), 'iptvnator-linux-notices-')
    );
    const inputRoot = path.join(fixtureRoot, 'inputs');
    const firstOutput = path.join(fixtureRoot, 'first');
    const secondOutput = path.join(fixtureRoot, 'second');
    t.after(() => {
        fs.rmSync(sourceRoot, { recursive: true, force: true });
        fs.rmSync(fixtureRoot, { recursive: true, force: true });
    });

    const manifest = runtimeManifest();
    collectLinuxRuntimeLicenseInputs({
        sourceRoot,
        outputRoot: inputRoot,
        runtimeManifest: manifest,
    });
    const first = generateLinuxRuntimeNotices({
        licenseInputRoot: inputRoot,
        outputRoot: firstOutput,
        runtimeManifest: manifest,
    });
    const second = generateLinuxRuntimeNotices({
        licenseInputRoot: inputRoot,
        outputRoot: secondOutput,
        runtimeManifest: manifest,
    });

    assert.deepEqual(fileTree(firstOutput), fileTree(secondOutput));
    assert.deepEqual(first, second);
    assert.equal(first.schemaVersion, 1);
    assert.equal(first.origin, 'pinned-linux-runtime-upstream-licenses');
    assert.deepEqual(
        first.packages.map(({ id }) => id),
        SOURCE_PACKAGES.map(({ id }) => id).sort()
    );
    assert.ok(first.packages.every(({ files }) => files.length >= 1));
    assert.deepEqual(LICENSE_PATHS_BY_PACKAGE.libplacebo, [
        'LICENSE',
        '3rdparty/Vulkan-Headers/LICENSE.md',
        '3rdparty/fast_float/LICENSE-APACHE',
        '3rdparty/fast_float/LICENSE-BOOST',
        '3rdparty/fast_float/LICENSE-MIT',
        '3rdparty/glad/LICENSE',
        '3rdparty/jinja/LICENSE.txt',
        '3rdparty/markupsafe/LICENSE.txt',
        'demos/3rdparty/nuklear/LICENSE',
    ]);
    assert.deepEqual(validateLinuxRuntimeNotices(firstOutput, manifest), []);

    const noticeContents = fs.readFileSync(
        path.join(firstOutput, 'THIRD_PARTY_NOTICES.txt')
    );
    assert.equal(first.noticeFile.path, 'THIRD_PARTY_NOTICES.txt');
    assert.equal(first.noticeFile.size, noticeContents.length);
    assert.equal(
        first.noticeFile.sha256,
        crypto.createHash('sha256').update(noticeContents).digest('hex')
    );
    assert.match(
        noticeContents.toString('utf8'),
        /exact corresponding sources and build scripts are distributed alongside the binary release as linux-frame-copy-runtime-sources\.tar\.xz/
    );

    for (const packageRecord of first.packages) {
        for (const fileRecord of packageRecord.files) {
            const outputContents = fs.readFileSync(
                path.join(firstOutput, fileRecord.path)
            );
            const sourcePath = fileRecord.path.slice(
                `licenses/${packageRecord.id}/`.length
            );
            assert.ok(
                LICENSE_PATHS_BY_PACKAGE[packageRecord.id].includes(sourcePath)
            );
            assert.deepEqual(
                outputContents,
                fs.readFileSync(
                    path.join(sourceRoot, packageRecord.id, sourcePath)
                )
            );
        }
    }
});

test('rejects symlinked license sources and path escapes', (t) => {
    const sourceRoot = createSourceFixture();
    const outputRoot = fs.mkdtempSync(
        path.join(os.tmpdir(), 'iptvnator-linux-license-inputs-')
    );
    const outsidePath = path.join(outputRoot, 'outside-license');
    fs.writeFileSync(outsidePath, 'outside\n');
    t.after(() => {
        fs.rmSync(sourceRoot, { recursive: true, force: true });
        fs.rmSync(outputRoot, { recursive: true, force: true });
    });

    const freetypeLicense = path.join(
        sourceRoot,
        'freetype',
        LICENSE_PATHS_BY_PACKAGE.freetype[0]
    );
    fs.rmSync(freetypeLicense);
    fs.symlinkSync(outsidePath, freetypeLicense);

    assert.throws(
        () =>
            collectLinuxRuntimeLicenseInputs({
                sourceRoot,
                outputRoot: path.join(outputRoot, 'collected'),
                runtimeManifest: runtimeManifest(),
            }),
        /symbolic link|outside/i
    );
});

test('rejects missing, tampered, and undeclared cached license inputs', (t) => {
    const sourceRoot = createSourceFixture();
    const fixtureRoot = fs.mkdtempSync(
        path.join(os.tmpdir(), 'iptvnator-linux-license-cache-')
    );
    const inputRoot = path.join(fixtureRoot, 'inputs');
    t.after(() => {
        fs.rmSync(sourceRoot, { recursive: true, force: true });
        fs.rmSync(fixtureRoot, { recursive: true, force: true });
    });

    const manifest = runtimeManifest();
    collectLinuxRuntimeLicenseInputs({
        sourceRoot,
        outputRoot: inputRoot,
        runtimeManifest: manifest,
    });
    const collectedManifest = JSON.parse(
        fs.readFileSync(
            path.join(inputRoot, 'linux-runtime-license-inputs.json'),
            'utf8'
        )
    );
    const firstLicensePath = path.join(
        inputRoot,
        collectedManifest.packages[0].files[0].path
    );
    fs.appendFileSync(firstLicensePath, 'tampered\n');
    assert.throws(
        () =>
            generateLinuxRuntimeNotices({
                licenseInputRoot: inputRoot,
                outputRoot: path.join(fixtureRoot, 'tampered-output'),
                runtimeManifest: manifest,
            }),
        /(?:Size|SHA-256) mismatch/
    );

    collectLinuxRuntimeLicenseInputs({
        sourceRoot,
        outputRoot: inputRoot,
        runtimeManifest: manifest,
    });
    fs.writeFileSync(path.join(inputRoot, 'licenses', 'undeclared.txt'), 'x');
    assert.throws(
        () =>
            generateLinuxRuntimeNotices({
                licenseInputRoot: inputRoot,
                outputRoot: path.join(fixtureRoot, 'extra-output'),
                runtimeManifest: manifest,
            }),
        /undeclared license input/
    );

    fs.rmSync(path.join(inputRoot, 'licenses', 'undeclared.txt'));
    fs.rmSync(
        path.join(inputRoot, collectedManifest.packages[0].files[0].path)
    );
    assert.throws(
        () =>
            generateLinuxRuntimeNotices({
                licenseInputRoot: inputRoot,
                outputRoot: path.join(fixtureRoot, 'missing-output'),
                runtimeManifest: manifest,
            }),
        /Missing .*license input/
    );
});

test('CLI collects immutable inputs and regenerates the packaged notice bundle', (t) => {
    const sourceRoot = createSourceFixture();
    const fixtureRoot = fs.mkdtempSync(
        path.join(os.tmpdir(), 'iptvnator-linux-notices-cli-')
    );
    const manifestPath = path.join(fixtureRoot, 'runtime-manifest.json');
    const inputRoot = path.join(fixtureRoot, 'inputs');
    const outputRoot = path.join(fixtureRoot, 'notices');
    fs.writeFileSync(
        manifestPath,
        `${JSON.stringify(runtimeManifest(), null, 2)}\n`
    );
    t.after(() => {
        fs.rmSync(sourceRoot, { recursive: true, force: true });
        fs.rmSync(fixtureRoot, { recursive: true, force: true });
    });

    for (const args of [
        [
            'collect',
            '--runtime-manifest',
            manifestPath,
            '--source-root',
            sourceRoot,
            '--output-root',
            inputRoot,
        ],
        [
            'generate',
            '--runtime-manifest',
            manifestPath,
            '--license-input-root',
            inputRoot,
            '--output-root',
            outputRoot,
        ],
    ]) {
        const result = spawnSync(process.execPath, [generatorScript, ...args], {
            encoding: 'utf8',
        });
        assert.equal(
            result.status,
            0,
            [result.stdout, result.stderr].filter(Boolean).join('\n')
        );
    }
    assert.deepEqual(
        validateLinuxRuntimeNotices(outputRoot, runtimeManifest()),
        []
    );
});
