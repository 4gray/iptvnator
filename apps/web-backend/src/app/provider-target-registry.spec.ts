import { ProviderTargetRegistry } from './provider-target-registry';

describe('ProviderTargetRegistry', () => {
    it('evicts the least recently used address without evicting active ones', () => {
        const registry = new ProviderTargetRegistry({ capacity: 2 });
        const first = registry.register(new URL('https://one.test'));
        const second = registry.register(new URL('https://two.test'));
        expect(registry.get(first)?.hostname).toBe('one.test');
        registry.register(new URL('https://three.test'));
        expect(registry.get(second)).toBeUndefined();
        expect(registry.get(first)).toBeDefined();
    });

    it('expires idle targets and refreshes the idle deadline on use', () => {
        let now = 0;
        const registry = new ProviderTargetRegistry({
            ttlMs: 10,
            now: () => now,
        });
        const id = registry.register(new URL('https://one.test'));
        now = 9;
        expect(registry.get(id)).toBeDefined();
        now = 18;
        expect(registry.get(id)).toBeDefined();
        now = 28;
        expect(registry.get(id)).toBeUndefined();
        expect(registry.register(new URL('https://one.test'))).toBe(id);
    });

    it('refreshes existing registrations rather than consuming another slot', () => {
        const registry = new ProviderTargetRegistry({ capacity: 2 });
        const url = new URL('https://one.test');
        const first = registry.register(url);
        const second = registry.register(new URL('https://two.test'));
        expect(registry.register(url)).toBe(first);
        expect(registry.get(second)).toBeDefined();
    });
});
