/**
 * nx-electron build hook (project.json `webpackConfig`).
 *
 * The backend compiles with TypeScript's NodeNext resolution, which spells a
 * relative dynamic import with a `.js` extension (main.ts loads
 * `./app/startup/deferred-events.js`). webpack must map that back onto the
 * `.ts` source, which is what `resolve.extensionAlias` does.
 */
module.exports = (config) => {
    // Async chunks keep their webpackChunkName instead of a numeric id, so
    // packaging and the layout check can list them by name.
    config.output = { ...config.output, chunkFilename: '[name].js' };
    config.resolve = {
        ...config.resolve,
        extensionAlias: {
            ...config.resolve?.extensionAlias,
            '.js': ['.ts', '.js'],
        },
    };
    return config;
};
