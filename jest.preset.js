const nxPreset = require('@nx/jest/preset').default;

const coverageReporters = ['json', 'json-summary', 'lcovonly', 'text-summary'];

const collectCoverageFrom = [
    'src/**/*.{ts,js,mjs,html}',
    '!src/**/*.{spec,test}.ts',
    '!src/**/test-setup.ts',
    '!src/**/test-stubs/**',
    '!src/**/*.generated.*',
    '!src/**/environments/**',
    '!src/**/index.ts',
];

// CI points every Jest run at one directory (JEST_CACHE_DIRECTORY) so the
// transform cache can be persisted between workflow runs; unset, Jest keeps
// its default per-user temp directory.
const cacheDirectory = process.env.JEST_CACHE_DIRECTORY
    ? { cacheDirectory: process.env.JEST_CACHE_DIRECTORY }
    : {};

module.exports = {
    ...nxPreset,
    ...cacheDirectory,
    coverageReporters,
    collectCoverageFrom,
};
