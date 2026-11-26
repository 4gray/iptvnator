import 'node:tls';

// Electron embeds Node 24 while the workspace still uses Node 20 typings.
declare module 'node:tls' {
    export function getCACertificates(type: 'default' | 'system'): string[];
}
