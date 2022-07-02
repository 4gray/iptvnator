module.exports = {
    preset: 'jest-preset-angular',
    resetMocks: true,
    setupFilesAfterEnv: ['<rootDir>/src/setup-jest.ts'],
    testMatch: ['**/+(*.)+(spec).+(ts)?(x)'],
    coverageReporters: ['html', 'lcov'],
    transformIgnorePatterns: ['node_modules/(?!.*.mjs$|@datorama/akita)'],
};
