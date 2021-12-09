//Polyfill Node.js core modules in Webpack. This module is only needed for webpack 5+.
const NodePolyfillPlugin = require('node-polyfill-webpack-plugin');

/**
 * Custom angular webpack configuration
 */
module.exports = (config, options) => {
    config.target = 'electron-renderer';

    if (options.fileReplacements) {
        for (let fileReplacement of options.fileReplacements) {
            if (fileReplacement.replace !== 'src/environments/environment.ts') {
                continue;
            }

            let fileReplacementParts = fileReplacement['with'].split('.');
            if (
                fileReplacementParts.length > 1 &&
                ['web'].indexOf(fileReplacementParts[1]) >= 0
            ) {
                config.target = 'web';
            }
            break;
        }
    }

    config.plugins = [
        ...config.plugins,
        new NodePolyfillPlugin({
            excludeAliases: ['console'],
        }),
    ];

    return config;
};
