export default {
    displayName: '@iptvnator/shared/interfaces',
    preset: '../../../jest.preset.js',
    testEnvironment: 'node',
    // The LAN HTTP hash fallback is ESM, while this test project uses CJS.
    transformIgnorePatterns: [
        'node_modules/(?!@noble/hashes/|\\.pnpm/@noble\\+hashes@)',
    ],
    transform: {
        '^.+\\.[tj]s$': [
            'ts-jest',
            { tsconfig: '<rootDir>/tsconfig.spec.json' },
        ],
    },
    moduleFileExtensions: ['ts', 'js', 'html'],
    coverageDirectory: '../../../coverage/libs/shared/interfaces',
};
