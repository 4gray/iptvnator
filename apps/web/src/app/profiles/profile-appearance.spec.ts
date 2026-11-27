import { isSingleEmoji } from './profile-appearance';

describe('isSingleEmoji', () => {
    it.each(['🦊', '👩‍👩‍👧', '🇨🇭', '1️⃣', '👍🏽'])('accepts %s', (value) => {
        expect(isSingleEmoji(value)).toBe(true);
    });

    it.each(['', 'a', '🦊🦊', 'ab🦊', '1', '👩‍👩‍👧'.repeat(8)])(
        'refuses %j',
        (value) => {
            expect(isSingleEmoji(value)).toBe(false);
        }
    );
});
