/**
 * Git commit the app was built from. Populated by
 * tools/build/inject-build-commit.mjs during CI builds; stays empty for
 * local/dev builds, in which case Settings > About shows the plain version.
 *
 * Intentionally separate from AppConfig.version: appending the SHA to the
 * semver itself would flip electron-updater into prerelease mode and leak
 * into installer/artifact version fields.
 */
export const BUILD_COMMIT = '';
