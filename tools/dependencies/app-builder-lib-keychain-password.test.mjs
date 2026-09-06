/**
 * Guards `patches/app-builder-lib@<version>.patch`.
 *
 * electron-builder 26.15.x hands the certificate's `.p12` import password to
 * `security set-key-partition-list -k`, which authenticates against the
 * temporary keychain — so it needs the keychain's own generated password
 * (upstream #10066, fixed on master in #10101 and backported to release/v26 in
 * #10172, not yet in a published 26.x). macOS runner images since
 * `macos-26-arm64` 20260831 verify that password, and `Build on macos arm64`
 * failed with `SecKeychainUnlock: The user name or passphrase you entered is
 * not correct`. The patch applies the backport to the compiled package.
 *
 * Two checks: the installed source carries the fix (a dependency bump that
 * drops the patch must not silently reintroduce the bug), and the behavior
 * holds when `createKeychain` runs against a recorded `security` — the
 * partition-list call must use the password `create-keychain` was given, not
 * the import password.
 *
 * Retire this test together with the patch once electron-builder resolves an
 * `app-builder-lib` that contains #10172.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

const require = createRequire(import.meta.url);

// app-builder-lib is a transitive dependency of electron-builder; pnpm's
// strict layout keeps it out of the root node_modules, so resolve it the way
// electron-builder itself does.
const electronBuilderDir = path.dirname(
    require.resolve('electron-builder/package.json')
);
const appBuilderLibPackage = require.resolve('app-builder-lib/package.json', {
    paths: [electronBuilderDir],
});
const appBuilderLibDir = path.dirname(appBuilderLibPackage);
const macCodeSignPath = path.join(
    appBuilderLibDir,
    'out/codeSign/macCodeSign.js'
);

const IMPORT_PASSWORD = 'certificate-import-password';

describe('app-builder-lib keychain password patch', () => {
    it('targets the version the patch was written for', () => {
        const { version } = JSON.parse(
            readFileSync(appBuilderLibPackage, 'utf8')
        );
        const rootPackage = JSON.parse(
            readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
        );
        const patched = Object.keys(
            rootPackage.pnpm?.patchedDependencies ?? {}
        );

        assert.ok(
            patched.includes(`app-builder-lib@${version}`),
            `installed app-builder-lib ${version} has no entry in pnpm.patchedDependencies (${patched.join(', ')}) — bump or retire the patch`
        );
    });

    it('passes the keychain password, not the import password, to set-key-partition-list', () => {
        const source = readFileSync(macCodeSignPath, 'utf8');

        assert.match(
            source,
            /"set-key-partition-list", "-S", "apple-tool:,apple:", "-s", "-k", keychainPassword, keychainFile/
        );
        assert.match(
            source,
            /importCerts\(keychainFile, certPaths, cscPasswords, keychainPassword\)/
        );
        assert.doesNotMatch(
            source,
            /"set-key-partition-list", "-S", "apple-tool:,apple:", "-s", "-k", password, keychainFile/
        );
    });

    describe('createKeychain against a recorded security binary', () => {
        const calls = [];
        let cacheDir;
        let tmpRoot;
        let builderUtil;
        let originalExec;
        let macCodeSign;

        before(() => {
            cacheDir = mkdtempSync(
                path.join(tmpdir(), 'app-builder-lib-cache-')
            );
            tmpRoot = mkdtempSync(path.join(tmpdir(), 'app-builder-lib-tmp-'));
            // Keep createKeychain's only real filesystem side effects (the bundled
            // root-certs keychain copy and the temp keychain path) out of the
            // user's cache and temp directories.
            process.env.ELECTRON_BUILDER_CACHE = cacheDir;
            process.env.APP_BUILDER_TMP_DIR = tmpRoot;

            // The compiled code reads `exec` off builder-util's util module at
            // call time (`(0, builder_util_1.exec)(...)`), so replacing the
            // export records every `/usr/bin/security` invocation without
            // touching a real keychain.
            builderUtil = require(
                require.resolve('builder-util/out/util', {
                    paths: [appBuilderLibDir],
                })
            );
            originalExec = builderUtil.exec;
            builderUtil.exec = async (file, args) => {
                calls.push({ file, args: [...(args ?? [])] });
                return '';
            };
            macCodeSign = require(macCodeSignPath);
        });

        after(() => {
            builderUtil.exec = originalExec;
            delete process.env.ELECTRON_BUILDER_CACHE;
            delete process.env.APP_BUILDER_TMP_DIR;
            rmSync(cacheDir, { recursive: true, force: true });
            rmSync(tmpRoot, { recursive: true, force: true });
        });

        it('unlocks the partition list with the generated keychain password', async () => {
            const { TmpDir } = require(
                require.resolve('builder-util', { paths: [appBuilderLibDir] })
            );
            const tmpDir = new TmpDir('keychain-password-test');

            try {
                await macCodeSign.createKeychain({
                    tmpDir,
                    // Base64 links are written to a temp file without inspection;
                    // only the path reaches the recorded `security import`.
                    cscLink: Buffer.from('not a real p12').toString('base64'),
                    cscKeyPassword: IMPORT_PASSWORD,
                    currentDir: tmpRoot,
                });
            } finally {
                await tmpDir.cleanup();
            }

            const security = calls.filter(
                (call) => call.file === '/usr/bin/security'
            );
            const argAfter = (args, flag) => args[args.indexOf(flag) + 1];
            const created = security.find(
                (call) => call.args[0] === 'create-keychain'
            );
            const imported = security.find((call) => call.args[0] === 'import');
            const partition = security.find(
                (call) => call.args[0] === 'set-key-partition-list'
            );

            assert.ok(created, 'create-keychain was not invoked');
            assert.ok(imported, 'security import was not invoked');
            assert.ok(partition, 'set-key-partition-list was not invoked');

            const keychainPassword = argAfter(created.args, '-p');
            assert.ok(keychainPassword, 'create-keychain carried no password');
            assert.notEqual(keychainPassword, IMPORT_PASSWORD);
            assert.equal(argAfter(imported.args, '-P'), IMPORT_PASSWORD);
            assert.equal(
                argAfter(partition.args, '-k'),
                keychainPassword,
                'set-key-partition-list must authenticate with the keychain password'
            );
            assert.equal(
                partition.args.at(-1),
                created.args.at(-1),
                'same keychain file'
            );
        });
    });
});
