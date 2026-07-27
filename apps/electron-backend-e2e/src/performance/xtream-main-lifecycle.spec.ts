import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createXtreamMainLifecycleValidator } from './xtream-main-lifecycle';

describe('Xtream request-scoped main lifecycle validator', () => {
    it('reconstructs without module closures and accepts legal producer paths', () => {
        const restore = <T>(source: string): T =>
            new Function(`"use strict"; return (${source});`)() as T;
        const factory = restore<typeof createXtreamMainLifecycleValidator>(
            createXtreamMainLifecycleValidator.toString()
        );
        const validate = factory().validate;
        const network = phase('xtream.network.total', 100, 120);
        const json = phase('xtream.json.transform', 105, 110);
        const response = phase('xtream.response.ready', 121, 122);

        assert.equal(
            validate({
                method: 'xtreamRequest',
                outcome: 'success',
                phases: [network, json, response],
            }),
            null
        );
        assert.equal(
            validate({
                method: 'xtreamRequest',
                outcome: 'error',
                phases: [network],
            }),
            null
        );
        assert.equal(
            validate({
                method: 'xtreamRequest',
                outcome: 'error',
                phases: [network, json],
            }),
            null
        );
        assert.equal(
            validate({
                method: 'xtreamCancelSession',
                outcome: 'success',
                phases: [phase('xtream.cancel-session', 100, 101)],
            }),
            null
        );
    });

    it('rejects incomplete and impossible request lifecycles', () => {
        const validate = createXtreamMainLifecycleValidator().validate;
        const network = phase('xtream.network.total', 100, 120);
        const json = phase('xtream.json.transform', 105, 110);

        assert.equal(
            validate({
                method: 'xtreamRequest',
                outcome: 'success',
                phases: [network, json],
            }),
            'main-phase-inventory-incomplete'
        );
        assert.equal(
            validate({
                method: 'xtreamRequest',
                outcome: 'success',
                phases: [
                    network,
                    json,
                    phase('xtream.response.ready', 119, 121),
                ],
            }),
            'main-phase-topology-invalid'
        );
        assert.equal(
            validate({
                method: 'xtreamRequest',
                outcome: 'error',
                phases: [network, phase('xtream.response.ready', 121, 122)],
            }),
            'main-phase-topology-invalid'
        );
    });
});

function phase(phaseName: string, startEpochMs: number, endEpochMs: number) {
    return {
        endEpochMs,
        phase: phaseName,
        startEpochMs,
    };
}
