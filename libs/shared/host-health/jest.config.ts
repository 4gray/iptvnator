export default {
    displayName: 'shared-host-health',
    preset: '../../../jest.preset.js',
    testEnvironment: 'node',
    transform: {
        '^.+\\.[tj]s$': [
            'ts-jest',
            { tsconfig: '<rootDir>/tsconfig.spec.json' },
        ],
    },
    moduleFileExtensions: ['ts', 'js'],
    coverageDirectory: '../../../coverage/libs/shared/host-health',
};
