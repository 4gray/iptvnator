import net from 'node:net';
import {
    applyDefaultAutoSelectFamilyAttemptTimeout,
    AUTO_SELECT_FAMILY_ATTEMPT_TIMEOUT_FLAG,
    DEFAULT_AUTO_SELECT_FAMILY_ATTEMPT_TIMEOUT_MS,
    hasExplicitAttemptTimeoutFlag,
} from './network-family-autoselection';

describe('network family autoselection tuning', () => {
    it('raises the attempt timeout when the operator set nothing', () => {
        const setAttemptTimeout = jest.fn();

        const applied = applyDefaultAutoSelectFamilyAttemptTimeout({
            execArgv: [],
            nodeOptions: '',
            setAttemptTimeout,
        });

        expect(applied).toBe(DEFAULT_AUTO_SELECT_FAMILY_ATTEMPT_TIMEOUT_MS);
        expect(setAttemptTimeout).toHaveBeenCalledWith(
            DEFAULT_AUTO_SELECT_FAMILY_ATTEMPT_TIMEOUT_MS
        );
    });

    it('keeps an explicit --network-family-autoselection-attempt-timeout=<ms> flag', () => {
        const setAttemptTimeout = jest.fn();

        const applied = applyDefaultAutoSelectFamilyAttemptTimeout({
            execArgv: [`${AUTO_SELECT_FAMILY_ATTEMPT_TIMEOUT_FLAG}=1000`],
            nodeOptions: '',
            setAttemptTimeout,
        });

        expect(applied).toBeNull();
        expect(setAttemptTimeout).not.toHaveBeenCalled();
    });

    it('keeps the flag when it is passed as a separate argument', () => {
        const setAttemptTimeout = jest.fn();

        const applied = applyDefaultAutoSelectFamilyAttemptTimeout({
            execArgv: [AUTO_SELECT_FAMILY_ATTEMPT_TIMEOUT_FLAG, '1000'],
            nodeOptions: '',
            setAttemptTimeout,
        });

        expect(applied).toBeNull();
        expect(setAttemptTimeout).not.toHaveBeenCalled();
    });

    it('keeps the flag when it arrives through NODE_OPTIONS', () => {
        const setAttemptTimeout = jest.fn();

        const applied = applyDefaultAutoSelectFamilyAttemptTimeout({
            execArgv: [],
            nodeOptions: `--dns-result-order=ipv4first ${AUTO_SELECT_FAMILY_ATTEMPT_TIMEOUT_FLAG}=500`,
            setAttemptTimeout,
        });

        expect(applied).toBeNull();
        expect(setAttemptTimeout).not.toHaveBeenCalled();
    });

    it('keeps the underscore spelling Node also accepts', () => {
        const setAttemptTimeout = jest.fn();

        const viaArgv = applyDefaultAutoSelectFamilyAttemptTimeout({
            execArgv: ['--network_family_autoselection_attempt_timeout=500'],
            nodeOptions: '',
            setAttemptTimeout,
        });
        const viaNodeOptions = applyDefaultAutoSelectFamilyAttemptTimeout({
            execArgv: [],
            nodeOptions: '--network_family_autoselection_attempt_timeout=700',
            setAttemptTimeout,
        });

        expect(viaArgv).toBeNull();
        expect(viaNodeOptions).toBeNull();
        expect(setAttemptTimeout).not.toHaveBeenCalled();
    });

    it('detects the flag in both argv shapes and NODE_OPTIONS', () => {
        expect(
            hasExplicitAttemptTimeoutFlag(
                [`${AUTO_SELECT_FAMILY_ATTEMPT_TIMEOUT_FLAG}=250`],
                ''
            )
        ).toBe(true);
        expect(
            hasExplicitAttemptTimeoutFlag(
                [AUTO_SELECT_FAMILY_ATTEMPT_TIMEOUT_FLAG],
                ''
            )
        ).toBe(true);
        expect(
            hasExplicitAttemptTimeoutFlag(
                ['--network_family-autoselection_attempt-timeout=250'],
                ''
            )
        ).toBe(true);
        expect(
            hasExplicitAttemptTimeoutFlag(
                [],
                `${AUTO_SELECT_FAMILY_ATTEMPT_TIMEOUT_FLAG} 250`
            )
        ).toBe(true);
        expect(
            hasExplicitAttemptTimeoutFlag(
                ['--no-network-family-autoselection'],
                '--dns-result-order=ipv4first'
            )
        ).toBe(false);
    });

    it('ignores the flag text embedded in another option value or name', () => {
        const setAttemptTimeout = jest.fn();

        // The flag string inside another option's VALUE is not the option.
        const applied = applyDefaultAutoSelectFamilyAttemptTimeout({
            execArgv: [],
            nodeOptions:
                '--title=--network-family-autoselection-attempt-timeout-worker',
            setAttemptTimeout,
        });

        expect(applied).toBe(DEFAULT_AUTO_SELECT_FAMILY_ATTEMPT_TIMEOUT_MS);
        expect(setAttemptTimeout).toHaveBeenCalledWith(
            DEFAULT_AUTO_SELECT_FAMILY_ATTEMPT_TIMEOUT_MS
        );

        // A longer option NAME that merely starts with the flag text is a
        // different option.
        expect(
            hasExplicitAttemptTimeoutFlag(
                ['--network-family-autoselection-attempt-timeout-worker=5'],
                ''
            )
        ).toBe(false);
    });

    it('applies the timeout to the real net default when nothing is injected', () => {
        const original = net.getDefaultAutoSelectFamilyAttemptTimeout();
        try {
            const applied = applyDefaultAutoSelectFamilyAttemptTimeout({
                execArgv: [],
                nodeOptions: '',
            });

            expect(applied).toBe(DEFAULT_AUTO_SELECT_FAMILY_ATTEMPT_TIMEOUT_MS);
            expect(net.getDefaultAutoSelectFamilyAttemptTimeout()).toBe(
                DEFAULT_AUTO_SELECT_FAMILY_ATTEMPT_TIMEOUT_MS
            );
        } finally {
            net.setDefaultAutoSelectFamilyAttemptTimeout(original);
        }
    });
});
