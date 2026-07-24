'use strict';

const fs = require('fs');
const path = require('path');

const expectedElfMagic = Buffer.from([0x7f, 0x45, 0x4c, 0x46]);
const executableModeBits = 0o111;

function fsErrorCode(error) {
    return error && typeof error === 'object' && typeof error.code === 'string'
        ? error.code
        : 'UNKNOWN';
}

function validateBinarySibling(siblingPath, errors) {
    try {
        fs.lstatSync(siblingPath);
    } catch (error) {
        if (fsErrorCode(error) === 'ENOENT') {
            return;
        }
        errors.push(
            `Unable to inspect Flatpak Electron launcher binary sibling at ${siblingPath} (${fsErrorCode(error)}).`
        );
        return;
    }

    errors.push(
        `Flatpak Electron layout must not include a launcher binary sibling: ${siblingPath}`
    );
}

function validateFlatpakLauncher(appDir, executableName) {
    const errors = [];
    const launcherPath = path.join(appDir, executableName);
    const flatpakBinarySiblingPath = `${launcherPath}.bin`;
    validateBinarySibling(flatpakBinarySiblingPath, errors);

    let descriptor;
    try {
        descriptor = fs.openSync(
            launcherPath,
            fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW
        );
    } catch (error) {
        const errorCode = fsErrorCode(error);
        if (errorCode === 'ENOENT') {
            errors.push(
                `Missing Flatpak Electron ELF in ${appDir}: ${path.basename(launcherPath)}`
            );
        } else if (errorCode === 'ELOOP') {
            errors.push(
                `Flatpak Electron launcher must be a regular file: ${launcherPath}`
            );
        } else {
            errors.push(
                `Unable to open Flatpak Electron launcher at ${launcherPath} (${errorCode}).`
            );
        }
        return errors;
    }

    try {
        let launcherStat;
        try {
            launcherStat = fs.fstatSync(descriptor);
        } catch (error) {
            errors.push(
                `Unable to stat Flatpak Electron launcher at ${launcherPath} (${fsErrorCode(error)}).`
            );
            return errors;
        }

        if (!launcherStat.isFile()) {
            errors.push(
                `Flatpak Electron launcher must be a regular file: ${launcherPath}`
            );
            return errors;
        }
        if ((launcherStat.mode & executableModeBits) === 0) {
            errors.push(
                `Flatpak Electron launcher must be executable: ${launcherPath}`
            );
        }

        const elfMagic = Buffer.alloc(expectedElfMagic.length);
        let bytesRead;
        try {
            bytesRead = fs.readSync(
                descriptor,
                elfMagic,
                0,
                elfMagic.length,
                0
            );
        } catch (error) {
            errors.push(
                `Unable to read Flatpak Electron launcher at ${launcherPath} (${fsErrorCode(error)}).`
            );
            return errors;
        }

        if (
            bytesRead !== expectedElfMagic.length ||
            !elfMagic.equals(expectedElfMagic)
        ) {
            errors.push(
                `Flatpak Electron launcher must be an ELF binary: ${launcherPath}`
            );
        }
    } finally {
        try {
            fs.closeSync(descriptor);
        } catch (error) {
            errors.push(
                `Unable to close Flatpak Electron launcher at ${launcherPath} (${fsErrorCode(error)}).`
            );
        }
    }
    return errors;
}

module.exports = {
    validateFlatpakLauncher,
};
