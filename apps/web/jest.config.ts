import { nxPreset } from '@nx/jest/preset.js';
import { createEsmPreset } from 'jest-preset-angular/presets/index.js';

const angularEsmPreset = createEsmPreset({
  diagnostics: false,
  tsconfig: '<rootDir>/tsconfig.spec.json',
});

export default {
  ...nxPreset,
  ...angularEsmPreset,
  displayName: 'web',
  setupFilesAfterEnv: ['<rootDir>/src/test-setup.ts'],
  coverageDirectory: '../../coverage/apps/web',
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
    tslib: 'tslib/tslib.es6.js',
    '^iptv-playlist-parser$':
      '<rootDir>/src/test-stubs/iptv-playlist-parser.mjs',
    '^rxjs': '<rootDir>/../../node_modules/rxjs/dist/bundles/rxjs.umd.js',
    '^uuid$': '<rootDir>/../../node_modules/uuid/wrapper.mjs',
  },
  transform: angularEsmPreset.transform,
  transformIgnorePatterns: [],
  extensionsToTreatAsEsm: angularEsmPreset.extensionsToTreatAsEsm,
  coverageReporters: [
    ...(nxPreset.coverageReporters ?? []),
  ],
};
