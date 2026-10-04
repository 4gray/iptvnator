export default {
    displayName: 'electron-backend',
    preset: '../../jest.preset.js',
    testEnvironment: 'node',
    // Standalone window documents are markup, not executable backend source.
    // Angular projects retain template instrumentation through their own preset.
    coveragePathIgnorePatterns: ['/node_modules/', '\\.html$'],
    transform: {
        '^.+\\.[tj]s$': [
            'ts-jest',
            { tsconfig: '<rootDir>/tsconfig.spec.json' },
        ],
    },
    moduleFileExtensions: ['ts', 'js', 'html'],
    coverageDirectory: '../../coverage/apps/electron-backend',
};
