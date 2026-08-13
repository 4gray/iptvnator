import { nxPreset } from '@nx/jest/preset.js';
import { createEsmPreset } from 'jest-preset-angular/presets/index.js';

const angularEsmPreset = createEsmPreset({
    diagnostics: false,
    tsconfig: '<rootDir>/apps/web/tsconfig.spec.json',
});

const coverageReporters = ['json', 'json-summary', 'lcovonly', 'text-summary'];

export default {
    ...nxPreset,
    ...angularEsmPreset,
    rootDir: '.',
    roots: ['<rootDir>/apps/web', '<rootDir>/libs'],
    // Jest's 5s default is thin for Angular component specs: TestBed compiles
    // and instantiates a real component tree per test, and CI runners are far
    // slower per-core than a dev machine. A starved worker then fails a test
    // that is merely slow, with no defect behind it. Raised as headroom only —
    // a spec that genuinely hangs still fails, just later.
    testTimeout: 15_000,
    setupFilesAfterEnv: ['<rootDir>/apps/web/src/test-setup.ts'],
    resolver: nxPreset.resolver,
    moduleFileExtensions: Array.from(
        new Set([
            ...(nxPreset.moduleFileExtensions ?? []),
            ...(angularEsmPreset.moduleFileExtensions ?? []),
        ])
    ),
    testMatch: nxPreset.testMatch,
    testEnvironmentOptions: {},
    snapshotSerializers: angularEsmPreset.snapshotSerializers,
    moduleNameMapper: {
        ...(angularEsmPreset.moduleNameMapper ?? {}),
        '^@iptvnator/portal/xtream/feature$':
            '<rootDir>/apps/web/src/test-stubs/xtream-feature.stub.ts',
        tslib: 'tslib/tslib.es6.js',
        '^iptv-playlist-parser$':
            '<rootDir>/apps/web/src/test-stubs/iptv-playlist-parser.mjs',
        '^shaka-player$': '<rootDir>/apps/web/src/test-stubs/shaka-player.js',
        '^rxjs': '<rootDir>/node_modules/rxjs/dist/bundles/rxjs.umd.js',
        '^uuid$': '<rootDir>/node_modules/uuid/wrapper.mjs',
    },
    transform: angularEsmPreset.transform,
    transformIgnorePatterns: [],
    extensionsToTreatAsEsm: angularEsmPreset.extensionsToTreatAsEsm,
    modulePathIgnorePatterns: ['<rootDir>/dist/', '<rootDir>/.nx/'],
    watchPathIgnorePatterns: ['<rootDir>/dist/', '<rootDir>/.nx/'],
    coverageReporters,
};
