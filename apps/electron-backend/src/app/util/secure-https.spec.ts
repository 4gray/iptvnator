import { Agent } from 'node:https';
import type { LookupFunction } from 'node:net';
import {
    createPlaylistAgentFactory,
    isInsecureTlsAllowed,
} from './secure-https';

jest.mock('node:https', () => ({
    Agent: jest.fn(() => ({ protocol: 'https:' })),
}));

describe('secure-https', () => {
    const originalValue = process.env.IPTVNATOR_ALLOW_INSECURE_TLS;
    const agentConstructorMock = Agent as unknown as jest.Mock;
    const lookup = jest.fn() as unknown as LookupFunction;

    beforeEach(() => {
        agentConstructorMock.mockClear();
    });

    afterEach(() => {
        if (originalValue === undefined) {
            delete process.env.IPTVNATOR_ALLOW_INSECURE_TLS;
        } else {
            process.env.IPTVNATOR_ALLOW_INSECURE_TLS = originalValue;
        }
    });

    it('validates certificates by default', () => {
        delete process.env.IPTVNATOR_ALLOW_INSECURE_TLS;

        expect(isInsecureTlsAllowed()).toBe(false);
        createPlaylistAgentFactory().createHttpsAgent(lookup);

        expect(agentConstructorMock).toHaveBeenCalledWith({
            lookup,
            rejectUnauthorized: true,
        });
    });

    it.each(['1', 'true', ' TRUE '])(
        'allows an explicit insecure TLS opt-in via %s',
        (value) => {
            process.env.IPTVNATOR_ALLOW_INSECURE_TLS = value;

            expect(isInsecureTlsAllowed()).toBe(true);
            createPlaylistAgentFactory().createHttpsAgent(lookup);

            expect(agentConstructorMock).toHaveBeenCalledWith({
                lookup,
                rejectUnauthorized: false,
            });
        }
    );

    it('does not accept unrelated truthy values', () => {
        process.env.IPTVNATOR_ALLOW_INSECURE_TLS = 'yes';

        expect(isInsecureTlsAllowed()).toBe(false);
    });

    it('preserves TLS policy when no pinned lookup is required', () => {
        delete process.env.IPTVNATOR_ALLOW_INSECURE_TLS;

        createPlaylistAgentFactory().createHttpsAgent();

        expect(agentConstructorMock).toHaveBeenCalledWith({
            rejectUnauthorized: true,
        });
    });
});
