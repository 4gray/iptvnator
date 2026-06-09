const linuxAfterPack = require('./linux-after-pack.cjs');
const {
    validatePackagedEmbeddedMpv,
} = require('./embedded-mpv-packaging.cjs');
const fs = require('fs');
const path = require('path');

function log(message) {
    console.log(`  - ${message}`);
}

function isTruthy(value) {
    return ['1', 'true', 'yes', 'on'].includes(
        String(value ?? '')
            .trim()
            .toLowerCase()
    );
}

function copyEmbeddedMpvNativeOutput(resourceDir, projectDir) {
    const sourceDir = path.join(
        projectDir,
        'dist',
        'apps',
        'electron-backend',
        'native'
    );

    if (!fs.existsSync(sourceDir)) {
        return;
    }

    const destinationDir = path.join(
        resourceDir,
        'app.asar.unpacked',
        'electron-backend',
        'native'
    );

    fs.rmSync(destinationDir, { recursive: true, force: true });
    fs.cpSync(sourceDir, destinationDir, { recursive: true });
}

async function afterPackHook(params) {
    await linuxAfterPack(params);

    const requireEmbeddedMpv = isTruthy(
        process.env.IPTVNATOR_REQUIRE_EMBEDDED_MPV
    );
    log(
        requireEmbeddedMpv
            ? `validating required embedded MPV ${params.electronPlatformName} runtime`
            : `validating optional embedded MPV ${params.electronPlatformName} runtime`
    );
    const resourceDir = getResourceDir(params);

    copyEmbeddedMpvNativeOutput(
        resourceDir,
        params.packager.projectDir ?? process.cwd()
    );

    const errors = validatePackagedEmbeddedMpv(resourceDir, {
        platform: params.electronPlatformName,
        required: requireEmbeddedMpv,
    });

    if (errors.length > 0) {
        throw new Error(
            [
                `Embedded MPV ${params.electronPlatformName} package validation failed.`,
                ...errors.map((error) => `- ${error}`),
            ].join('\n')
        );
    }

    log(`embedded MPV ${params.electronPlatformName} runtime validated`);
}

function getResourceDir(params) {
    if (params.electronPlatformName !== 'darwin') {
        return path.join(params.appOutDir, 'resources');
    }

    const appPath = params.appOutDir.endsWith('.app')
        ? params.appOutDir
        : fs
              .readdirSync(params.appOutDir)
              .find((entry) => entry.endsWith('.app'));

    return appPath
        ? path.join(
              params.appOutDir.endsWith('.app')
                  ? params.appOutDir
                  : path.join(params.appOutDir, appPath),
              'Contents',
              'Resources'
          )
        : params.appOutDir;
}

module.exports = afterPackHook;
