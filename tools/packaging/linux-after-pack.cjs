const fs = require('fs/promises');
const path = require('path');

function log(message) {
    console.log(`  - ${message}`);
}

function createLoaderScript({ executableName, productName }) {
    return `#!/usr/bin/env bash
set -u

UNPRIVILEGED_USERNS_ENABLED=$(cat /proc/sys/kernel/unprivileged_userns_clone 2>/dev/null)
RESTRICT_UNPRIVILEGED_USERNS=$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null)

SCRIPT_PATH="\${BASH_SOURCE[0]}"
if command -v readlink >/dev/null 2>&1; then
    RESOLVED_SCRIPT_PATH=$(readlink -f "$SCRIPT_PATH" 2>/dev/null || true)
    if [ -n "$RESOLVED_SCRIPT_PATH" ]; then
        SCRIPT_PATH="$RESOLVED_SCRIPT_PATH"
    fi
fi

SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_PATH")" && pwd)"

APPLY_NO_SANDBOX_FLAG=0
if [ "$UNPRIVILEGED_USERNS_ENABLED" != 1 ] || [ "$RESTRICT_UNPRIVILEGED_USERNS" = 1 ]; then
    APPLY_NO_SANDBOX_FLAG=1
fi

if [ "$SCRIPT_DIR" = "/usr/bin" ]; then
    SCRIPT_DIR="/opt/${productName}"
fi

EXEC_ARGS=()
if [ "$APPLY_NO_SANDBOX_FLAG" = 1 ]; then
    echo "Note: Running with --no-sandbox since unprivileged_userns_clone is disabled or apparmor_restrict_unprivileged_userns is enabled."
    EXEC_ARGS+=(--no-sandbox)
fi

exec "$SCRIPT_DIR/${executableName}.bin" "\${EXEC_ARGS[@]}" "$@"
`;
}

async function afterPackHook(params) {
    if (params.electronPlatformName !== 'linux') {
        return;
    }

    log('applying Linux launcher sandbox fix');

    const executable = path.join(params.appOutDir, params.packager.executableName);

    try {
        await fs.rename(executable, `${executable}.bin`);
        await fs.writeFile(
            executable,
            createLoaderScript({
                executableName: params.packager.executableName,
                productName: params.packager.appInfo.productName,
            })
        );
        await fs.chmod(executable, 0o755);
    } catch (error) {
        log(`failed to create launcher wrapper: ${error.message}`);
        throw new Error('Failed to create launcher wrapper');
    }

    log('Linux launcher sandbox fix applied');
}

module.exports = afterPackHook;
module.exports.createLoaderScript = createLoaderScript;
