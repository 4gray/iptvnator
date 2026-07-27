export default {
    displayName: 'portal-stalker-replay-fixtures',
    preset: '../../../../jest.preset.js',
    testEnvironment: 'node',
    transform: {
        '^.+\\.[tj]s$': [
            'ts-jest',
            { tsconfig: '<rootDir>/tsconfig.spec.json' },
        ],
    },
    moduleNameMapper: {
        '^(\\.{1,2}/.*)\\.js$': '$1',
    },
    moduleFileExtensions: ['ts', 'js'],
    coverageDirectory:
        '../../../../coverage/libs/portal/stalker/replay-fixtures',
};
