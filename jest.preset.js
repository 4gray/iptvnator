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

module.exports = {
    ...nxPreset,
    coverageReporters,
    collectCoverageFrom,
};
