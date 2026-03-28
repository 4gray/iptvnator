import { nxPreset } from '@nx/jest/preset.js';
import { createEsmPreset } from 'jest-preset-angular/presets/index.js';

const angularEsmPreset = createEsmPreset({
    diagnostics: false,
    tsconfig: '<rootDir>/apps/web/tsconfig.spec.json',
});

export default {
    ...nxPreset,
    ...angularEsmPreset,
    rootDir: '.',
    roots: ['<rootDir>/apps/web', '<rootDir>/libs'],
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
        '^rxjs': '<rootDir>/node_modules/rxjs/dist/bundles/rxjs.umd.js',
        '^uuid$': '<rootDir>/node_modules/uuid/wrapper.mjs',
    },
    transform: angularEsmPreset.transform,
    transformIgnorePatterns: [],
    extensionsToTreatAsEsm: angularEsmPreset.extensionsToTreatAsEsm,
    modulePathIgnorePatterns: ['<rootDir>/dist/', '<rootDir>/.nx/'],
    watchPathIgnorePatterns: ['<rootDir>/dist/', '<rootDir>/.nx/'],
    coverageReporters: [...(nxPreset.coverageReporters ?? [])],
};
