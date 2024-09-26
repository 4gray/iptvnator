import angularEslintPlugin from '@angular-eslint/eslint-plugin';
import angularEslintTemplate from '@angular-eslint/eslint-plugin-template';
import parser from '@angular-eslint/template-parser';
import { FlatCompat } from '@eslint/eslintrc';
import js from '@eslint/js';
import ngrxEslint from '@ngrx/eslint-plugin';
import typescriptEslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import globals from 'globals';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({
    baseDirectory: __dirname,
    recommendedConfig: js.configs.recommended,
    allConfig: js.configs.all,
});

export default [
    {
        ignores: ['**/*.worker.ts'],
    },
    {
        languageOptions: {
            globals: {
                ...globals.browser,
                ...globals.node,
            },
        },
    },
    ...compat
        .extends(
            'eslint:recommended',
            'plugin:@typescript-eslint/eslint-recommended',
            'plugin:@typescript-eslint/recommended',
            'plugin:@typescript-eslint/recommended-requiring-type-checking'
        )
        .map((config) => ({
            ...config,
            files: ['**/*.ts'],
        })),
    {
        files: ['**/*.ts'],
        plugins: {
            '@typescript-eslint': typescriptEslint,
            '@angular-eslint': angularEslintPlugin,
            '@ngrx/recommended': ngrxEslint,
        },
        languageOptions: {
            parser: tsParser,
            ecmaVersion: 10,
            sourceType: 'module',

            parserOptions: {
                project: [
                    './tsconfig.serve.json',
                    './src/tsconfig.app.json',
                    './src/tsconfig.spec.json',
                    './e2e/tsconfig.e2e.json',
                ],

                ecmaFeatures: {
                    modules: true,
                },
            },
        },
        rules: {
            '@typescript-eslint/indent': 0,
            'no-unused-vars': 'off',
            '@typescript-eslint/no-unused-vars': ['error'],
            '@typescript-eslint/no-empty-function': 0,
            '@typescript-eslint/no-unsafe-argument': 0,
            '@typescript-eslint/no-var-requires': 0,
            '@typescript-eslint/no-explicit-any': 0,
            '@typescript-eslint/no-unsafe-call': 0,
            '@typescript-eslint/no-unsafe-member-access': 0,
            '@typescript-eslint/no-unsafe-assignment': 0,
            '@typescript-eslint/no-unsafe-return': 0,
            '@typescript-eslint/no-floating-promises': 0,
            '@typescript-eslint/unbound-method': ['off'],
            '@angular-eslint/use-injectable-provided-in': 'error',
            '@angular-eslint/no-attribute-decorator': 'error',
            '@typescript-eslint/no-require-imports': 'warn',
        },
    },
    {
        files: ['**/*.component.html'],
        plugins: {
            '@angular-eslint/template': angularEslintTemplate,
        },
        languageOptions: {
            parser: parser,
        },
        rules: {
            '@angular-eslint/template/banana-in-box': 'error',
            '@angular-eslint/template/no-negated-async': 'error',
        },
    },
];
