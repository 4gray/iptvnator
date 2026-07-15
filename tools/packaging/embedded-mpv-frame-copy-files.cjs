const fs = require('fs');
const path = require('path');

const FRAME_COPY_HELPER = 'iptvnator_mpv_helper';
const WINDOWS_FRAME_COPY_HELPER = 'iptvnator_mpv_helper.exe';
const FRAME_COPY_READER = 'embedded_mpv_frame_reader.node';

function preparePackagedFrameCopyArtifacts(nativeDir, platform) {
    const helperPath = path.join(
        nativeDir,
        platform === 'win32'
            ? WINDOWS_FRAME_COPY_HELPER
            : FRAME_COPY_HELPER
    );

    if (platform === 'linux') {
        // Until Linux ships a bundled libmpv runtime, do not package a helper
        // linked against the build host's system library.
        fs.rmSync(helperPath, { force: true });
        return;
    }

    if (platform !== 'win32' && fs.existsSync(helperPath)) {
        // Asset copying drops POSIX modes; restore spawn permission.
        fs.chmodSync(helperPath, 0o755);
    }
}

function removeStaleFrameCopyArtifacts(nativeDir) {
    for (const fileName of [
        FRAME_COPY_HELPER,
        WINDOWS_FRAME_COPY_HELPER,
        FRAME_COPY_READER,
    ]) {
        fs.rmSync(path.join(nativeDir, fileName), { force: true });
    }
}

module.exports = {
    preparePackagedFrameCopyArtifacts,
    removeStaleFrameCopyArtifacts,
};
