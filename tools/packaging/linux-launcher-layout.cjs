'use strict';

function normalizedTargetName(target) {
    const value =
        typeof target === 'string'
            ? target
            : target && typeof target === 'object'
              ? target.name
              : null;
    if (typeof value !== 'string' || value.trim() === '') {
        throw new Error('Linux launcher targets must expose a non-empty name.');
    }
    return value.trim().toLowerCase();
}

function resolveLinuxLauncherLayout(targets, executableName = 'iptvnator') {
    if (!Array.isArray(targets)) {
        throw new TypeError('Linux launcher targets must be an array.');
    }
    if (targets.length === 0) {
        throw new Error(
            'Linux launcher targets must contain at least one target.'
        );
    }

    const targetNames = [];
    for (const target of targets) {
        const targetName = normalizedTargetName(target);
        if (targetNames.includes(targetName)) {
            throw new Error(
                `Linux launcher target "${targetName}" is duplicated.`
            );
        }
        targetNames.push(targetName);
    }

    const flatpakSelected = targetNames.includes('flatpak');
    if (flatpakSelected && targetNames.length !== 1) {
        throw new Error(
            'Flatpak must be packaged in an isolated Electron Builder pass so Zypak receives the Electron ELF directly.'
        );
    }

    const wrapperRequired = !flatpakSelected;
    return {
        targetNames,
        electronBinaryName: wrapperRequired
            ? `${executableName}.bin`
            : executableName,
        wrapperRequired,
    };
}

module.exports = {
    resolveLinuxLauncherLayout,
};
