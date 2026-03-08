import nx from '@nx/eslint-plugin';

export default [
    ...nx.configs['flat/base'],
    ...nx.configs['flat/typescript'],
    ...nx.configs['flat/javascript'],
    {
        ignores: ['**/dist'],
    },
    {
        files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
        rules: {
            '@nx/enforce-module-boundaries': [
                'error',
                {
                    enforceBuildableLibDependency: true,
                    allow: ['^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$'],
                    depConstraints: [
                        {
                            sourceTag: 'type:app',
                            onlyDependOnLibsWithTags: [
                                'type:feature',
                                'type:ui',
                                'type:data-access',
                                'type:util',
                            ],
                        },
                        {
                            sourceTag: 'type:feature',
                            onlyDependOnLibsWithTags: [
                                'type:feature',
                                'type:ui',
                                'type:data-access',
                                'type:util',
                            ],
                        },
                        {
                            sourceTag: 'type:ui',
                            onlyDependOnLibsWithTags: [
                                'type:ui',
                                'type:data-access',
                                'type:util',
                            ],
                        },
                        {
                            sourceTag: 'type:data-access',
                            onlyDependOnLibsWithTags: [
                                'type:data-access',
                                'type:util',
                            ],
                        },
                        {
                            sourceTag: 'type:util',
                            onlyDependOnLibsWithTags: ['type:util'],
                        },
                        {
                            sourceTag: 'domain:portal-shared',
                            onlyDependOnLibsWithTags: [
                                'domain:portal-shared',
                                'domain:m3u',
                                'domain:playback',
                                'scope:shared',
                                'scope:portal',
                            ],
                        },
                        {
                            sourceTag: 'domain:xtream',
                            onlyDependOnLibsWithTags: [
                                'domain:xtream',
                                'domain:portal-shared',
                                'domain:m3u',
                                'scope:shared',
                            ],
                        },
                        {
                            sourceTag: 'domain:stalker',
                            onlyDependOnLibsWithTags: [
                                'domain:stalker',
                                'domain:portal-shared',
                                'domain:m3u',
                                'scope:shared',
                            ],
                        },
                        {
                            sourceTag: 'domain:workspace',
                            onlyDependOnLibsWithTags: [
                                'domain:workspace',
                                'domain:portal-shared',
                                'domain:xtream',
                                'domain:stalker',
                                'domain:m3u',
                                'scope:shared',
                            ],
                        },
                    ],
                },
            ],
        },
    },
    {
        files: [
            '**/*.ts',
            '**/*.tsx',
            '**/*.cts',
            '**/*.mts',
            '**/*.js',
            '**/*.jsx',
            '**/*.cjs',
            '**/*.mjs',
        ],
        // Override or add rules here
        rules: {
            '@angular-eslint/template/click-events-have-key-events': 'off',
            '@angular-eslint/template/interactive-supports-focus': 'off',
        },
    },
];
