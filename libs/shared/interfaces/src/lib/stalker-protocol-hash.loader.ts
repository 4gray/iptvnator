/** Keep protocol hashing out of consumers' eager dependency graphs. */
export function loadStalkerProtocolHash() {
    return import('./stalker-protocol-hash.util.js');
}
