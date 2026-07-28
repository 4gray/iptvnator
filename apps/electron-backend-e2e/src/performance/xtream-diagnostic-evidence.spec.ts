import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    assertXtreamArtifactRedacted,
    serializeXtreamArtifactForPersistence,
} from './xtream-diagnostic-artifacts';
import type { XtreamArtifactSafetyContext } from './xtream-summary-contract';

const TOKEN = 'diagnostic-control-token';
const SAFETY: XtreamArtifactSafetyContext = {
    controlToken: TOKEN,
    syntheticCredentials: {
        password: 'performance',
        username: 'performance',
    },
};
const SAFE_ERROR = 'Xtream artifact must remain credential-safe';

describe('Xtream diagnostic persistence safety', () => {
    it('rejects single- and double-percent-encoded synthetic credentials', () => {
        for (const endpoint of [
            'http://127.0.0.1/player_api.php?%75sername%3D%70erformance%26%70assword%3D%70erformance',
            'http://127.0.0.1/player_api.php?%2575sername%253D%2570erformance%2526%2570assword%253D%2570erformance',
            'http://%70erformance%3A%70erformance%40127.0.0.1/player_api.php',
            'http://%2570erformance%253A%2570erformance%2540127.0.0.1/player_api.php',
        ]) {
            assert.throws(
                () =>
                    serializeXtreamArtifactForPersistence({ endpoint }, SAFETY),
                exactSafeError
            );
        }
    });

    it('rejects triple encoding and fails closed beyond the decode cap', () => {
        const userInfo =
            'http://performance:performance@127.0.0.1/player_api.php';
        for (const endpoint of [
            encodeTimes(userInfo, 3),
            encodeTimes(userInfo, 9),
        ]) {
            assert.throws(
                () =>
                    serializeXtreamArtifactForPersistence({ endpoint }, SAFETY),
                exactSafeError
            );
        }
    });

    it('preserves benign malformed percent text', () => {
        assert.equal(
            serializeXtreamArtifactForPersistence(
                { label: 'progress is 100% complete' },
                SAFETY
            ),
            '{"label":"progress is 100% complete"}'
        );
    });

    it('does not let malformed percent text mask encoded credentials', () => {
        assert.throws(
            () =>
                serializeXtreamArtifactForPersistence(
                    {
                        endpoint:
                            'http://%ZZ%70erformance%3A%70erformance%40127.0.0.1/player_api.php',
                    },
                    SAFETY
                ),
            exactSafeError
        );
    });

    it('does not trust an array own forEach during standalone redaction', () => {
        const unsafe = [
            'http://mock.invalid/player_api.php?username=performance',
        ];
        Object.defineProperty(unsafe, 'forEach', {
            value: () => undefined,
        });

        assert.throws(
            () => assertXtreamArtifactRedacted(unsafe),
            exactSafeError
        );
    });

    it('revalidates the serialized JSON emitted by toJSON hooks', () => {
        assert.equal(
            serializeXtreamArtifactForPersistence(
                {
                    visible: true,
                    toJSON() {
                        return { visible: true };
                    },
                },
                SAFETY
            ),
            '{"visible":true}'
        );

        for (const unsafe of [
            {
                toJSON() {
                    return { username: 'injected-after-first-validation' };
                },
            },
            {
                toJSON() {
                    return {
                        endpoint:
                            'http://mock.invalid/player_api.php?token=late',
                    };
                },
            },
        ]) {
            assert.throws(
                () => serializeXtreamArtifactForPersistence(unsafe, SAFETY),
                exactSafeError
            );
        }
    });

    it('sanitizes ownKeys, getter, and revoked Proxy failures', () => {
        const ownKeysProxy = new Proxy(
            {},
            {
                ownKeys() {
                    throw new Error(TOKEN);
                },
            }
        );
        const safetyProxy = new Proxy(SAFETY, {
            get() {
                throw new Error(TOKEN);
            },
        });
        const getterValue = Object.defineProperty({}, 'visible', {
            enumerable: true,
            get() {
                throw new Error(TOKEN);
            },
        });
        const throwingJson = {
            toJSON() {
                throw new Error(TOKEN);
            },
        };
        const revocable = Proxy.revocable({}, {});
        revocable.revoke();

        assert.throws(
            () => assertXtreamArtifactRedacted(ownKeysProxy, [TOKEN]),
            exactSafeError
        );
        assert.throws(
            () => assertXtreamArtifactRedacted(revocable.proxy, [TOKEN]),
            exactSafeError
        );
        assert.throws(
            () =>
                serializeXtreamArtifactForPersistence(
                    { visible: true },
                    safetyProxy
                ),
            exactSafeError
        );
        assert.throws(
            () => serializeXtreamArtifactForPersistence(ownKeysProxy, SAFETY),
            exactSafeError
        );
        assert.throws(
            () => serializeXtreamArtifactForPersistence(getterValue, SAFETY),
            exactSafeError
        );
        assert.throws(
            () => serializeXtreamArtifactForPersistence(throwingJson, SAFETY),
            exactSafeError
        );
    });
});

function exactSafeError(error: unknown): boolean {
    return (
        error instanceof Error &&
        error.message === SAFE_ERROR &&
        !error.message.includes(TOKEN)
    );
}

function encodeTimes(value: string, count: number): string {
    let encoded = value;
    for (let pass = 0; pass < count; pass += 1) {
        encoded = encodeURIComponent(encoded);
    }
    return encoded;
}
