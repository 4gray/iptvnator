const linuxAfterPack = require('./linux-after-pack.cjs');
const {
    isForeignLinuxEmbeddedMpvArch,
    resolveElectronBuilderArchName,
    validatePackagedEmbeddedMpv,
} = require('./embedded-mpv-packaging.cjs');
const {
    resolveLinuxFrameCopyProfile,
    validateLinuxProfileTargets,
} = require('./linux-frame-copy-profile.cjs');
const fs = require('fs');
const path = require('path');
const {
    preparePackagedFrameCopyArtifacts,
} = require('./embedded-mpv-frame-copy-files.cjs');

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

function copyEmbeddedMpvNativeOutput(
    resourceDir,
    projectDir,
    platform,
    preparationOptions
) {
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

    const resolvedPreparationOptions =
        platform === 'linux' && preparationOptions
            ? {
                  ...preparationOptions,
                  noticeSourceDir: path.join(
                      projectDir,
                      'vendor',
                      'embedded-mpv',
                      'linux-x64',
                      'notices'
                  ),
              }
            : preparationOptions;
    return preparePackagedFrameCopyArtifacts(
        destinationDir,
        platform,
        resolvedPreparationOptions
    );
}

function writeEmbeddedMpvUnavailableMarker(resourceDir, targetArch) {
    const destinationDir = path.join(
        resourceDir,
        'app.asar.unpacked',
        'electron-backend',
        'native'
    );

    fs.rmSync(destinationDir, { recursive: true, force: true });
    fs.mkdirSync(destinationDir, { recursive: true });
    fs.writeFileSync(
        path.join(destinationDir, 'embedded-mpv-unavailable.txt'),
        `Embedded MPV is not bundled for ${targetArch} Linux builds yet. The built-in player and external MPV/VLC remain available.\n`
    );
}

function resolveLinuxFrameCopyPackagingContext(
    params,
    {
        required = isTruthy(process.env.IPTVNATOR_REQUIRE_EMBEDDED_MPV),
        environment = process.env,
    } = {}
) {
    if (params.electronPlatformName !== 'linux') {
        return null;
    }

    const targetArch = resolveElectronBuilderArchName(params.arch);
    if (!targetArch) {
        throw new Error(
            `Unknown Electron Builder architecture: ${String(params.arch)}.`
        );
    }
    const targetNames = [];
    for (const target of params.targets ?? []) {
        const targetName = String(target?.name ?? '')
            .trim()
            .toLowerCase();
        if (!targetName) {
            throw new Error(
                'Linux Electron Builder targets must expose a non-empty name.'
            );
        }
        if (targetNames.includes(targetName)) {
            throw new Error(
                `Linux Electron Builder target "${targetName}" is duplicated.`
            );
        }
        targetNames.push(targetName);
    }
    if (targetNames.length === 0) {
        throw new Error(
            'Linux Electron Builder must provide at least one packaging target.'
        );
    }

    // Official Linux frame-copy artifacts are intentionally x64-only. Do not
    // let a caller-provided build-arch environment value promote an ARM
    // package to a supported layout: every non-x64 target must remain the
    // marker-only native-view fallback.
    const foreignArch = targetArch !== 'x64';
    const profileValue =
        environment.IPTVNATOR_LINUX_FRAME_COPY_PROFILE?.trim() ?? '';
    if (!profileValue) {
        if (required && targetArch === 'x64') {
            resolveLinuxFrameCopyProfile(profileValue);
        }
        return {
            targetArch,
            foreignArch,
            targetNames,
            profile: null,
        };
    }

    const profile = resolveLinuxFrameCopyProfile(profileValue);
    const targetErrors = validateLinuxProfileTargets(profile.name, targetNames);
    if (targetErrors.length > 0) {
        throw new Error(targetErrors.join('\n'));
    }
    return {
        targetArch,
        foreignArch,
        targetNames,
        profile,
    };
}

async function afterPackHook(params) {
    const requireEmbeddedMpv = isTruthy(
        process.env.IPTVNATOR_REQUIRE_EMBEDDED_MPV
    );
    const linuxPackagingContext = resolveLinuxFrameCopyPackagingContext(
        params,
        {
            required: requireEmbeddedMpv,
            environment: process.env,
        }
    );

    await linuxAfterPack(params);

    log(
        requireEmbeddedMpv
            ? `validating required embedded MPV ${params.electronPlatformName} runtime`
            : `validating optional embedded MPV ${params.electronPlatformName} runtime`
    );
    const resourceDir = getResourceDir(params);

    const foreignArch =
        linuxPackagingContext?.foreignArch ??
        isForeignLinuxEmbeddedMpvArch(params.electronPlatformName, params.arch);
    if (foreignArch) {
        const targetArch = linuxPackagingContext.targetArch;
        log(
            `embedded MPV addon is not built for ${targetArch}; packaging an unavailable marker instead`
        );
        writeEmbeddedMpvUnavailableMarker(resourceDir, targetArch);
    } else {
        copyEmbeddedMpvNativeOutput(
            resourceDir,
            params.packager.projectDir ?? process.cwd(),
            params.electronPlatformName,
            linuxPackagingContext
                ? {
                      profile: linuxPackagingContext.profile?.name,
                      targetNames: linuxPackagingContext.targetNames,
                  }
                : undefined
        );
    }

    const errors = validatePackagedEmbeddedMpv(resourceDir, {
        platform: params.electronPlatformName,
        required: requireEmbeddedMpv,
        foreignArch,
        targetArch: linuxPackagingContext?.targetArch,
        profile: linuxPackagingContext?.profile?.name,
        targetNames: linuxPackagingContext?.targetNames,
        executableName: params.packager.executableName,
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
module.exports.resolveLinuxFrameCopyPackagingContext =
    resolveLinuxFrameCopyPackagingContext;
module.exports.writeEmbeddedMpvUnavailableMarker =
    writeEmbeddedMpvUnavailableMarker;
