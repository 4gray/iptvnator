'use strict';

function createProfile(name, runtimeMode, targets, manifestOrigin) {
    return Object.freeze({
        name,
        runtimeMode,
        targets: Object.freeze([...targets]),
        manifestOrigin,
    });
}

const LINUX_FRAME_COPY_PROFILES = Object.freeze({
    system: createProfile(
        'system',
        'system',
        ['deb', 'rpm', 'pacman'],
        'system-libmpv-frame-copy'
    ),
    portable: createProfile(
        'portable',
        'bundled',
        ['appimage', 'snap'],
        'bundled-lgpl-frame-copy'
    ),
    flatpak: createProfile(
        'flatpak',
        'bundled',
        ['flatpak'],
        'bundled-lgpl-frame-copy'
    ),
});
const SUPPORTED_PROFILE_NAMES = Object.freeze(
    Object.keys(LINUX_FRAME_COPY_PROFILES)
);

const LINUX_SYSTEM_PACKAGE_DEPENDENCIES = Object.freeze({
    deb: Object.freeze(['libmpv2', 'libegl1', 'libgl1', 'libgbm1']),
    rpm: Object.freeze([
        'mpv-libs',
        'libglvnd-egl',
        'libglvnd-glx',
        'mesa-libgbm',
    ]),
    pacman: Object.freeze(['mpv', 'libglvnd', 'mesa']),
});

function expectedProfileNames() {
    return SUPPORTED_PROFILE_NAMES.map((name) => `"${name}"`).join(', ');
}

function findLinuxFrameCopyProfile(value) {
    if (value == null || (typeof value === 'string' && value.trim() === '')) {
        throw new Error(
            `Linux frame-copy profile is required. Expected one of: ${expectedProfileNames()}.`
        );
    }

    const name = typeof value === 'string' ? value.trim() : String(value);
    if (!Object.hasOwn(LINUX_FRAME_COPY_PROFILES, name)) {
        throw new Error(
            `Unsupported Linux frame-copy profile "${name}". Expected one of: ${expectedProfileNames()}.`
        );
    }
    return LINUX_FRAME_COPY_PROFILES[name];
}

function resolveLinuxFrameCopyProfile(value) {
    const profile = findLinuxFrameCopyProfile(value);
    return createProfile(
        profile.name,
        profile.runtimeMode,
        profile.targets,
        profile.manifestOrigin
    );
}

function validateLinuxProfileTargets(profileName, targetNames) {
    const profile = findLinuxFrameCopyProfile(profileName);
    if (!Array.isArray(targetNames)) {
        throw new TypeError('Linux frame-copy targets must be an array.');
    }

    const allowedTargets = new Set(profile.targets);
    return targetNames.flatMap((targetName) => {
        const normalizedTarget = String(targetName).trim().toLowerCase();
        if (allowedTargets.has(normalizedTarget)) {
            return [];
        }
        return [
            `Linux frame-copy profile "${profile.name}" cannot build target "${normalizedTarget}".`,
        ];
    });
}

module.exports = {
    LINUX_FRAME_COPY_PROFILES,
    LINUX_SYSTEM_PACKAGE_DEPENDENCIES,
    resolveLinuxFrameCopyProfile,
    validateLinuxProfileTargets,
};
