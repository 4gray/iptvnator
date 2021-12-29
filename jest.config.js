module.exports = {
    "preset": "jest-preset-angular",
    "resetMocks": true,
    "setupFilesAfterEnv": [
        "<rootDir>/src/setup-jest.ts"
    ],
    "testMatch": [
        "**/+(*.)+(spec|test).+(ts)?(x)"
    ],
    "coverageReporters": [
        "html",
        "lcov"
    ]
};