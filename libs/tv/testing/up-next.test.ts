import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UP_NEXT_COLLAPSE_DELAY_MS } from '@iptvnator/shared/interfaces';
import * as tv from '@iptvnator/tv/util';

const episode = (id: string, season: number, number: number): tv.Media => ({
    id,
    sourceId: 'source',
    providerId: id,
    kind: 'episode',
    title: `Episode ${number}`,
    parentId: 'show',
    season,
    episode: number,
    raw: {},
});
const current = episode('e1', 1, 1);
const next = episode('e2', 1, 2);
const base: tv.UpNextInput = {
    current,
    next,
    durationSeconds: 22 * 60,
    positionSeconds: 22 * 60 - 30,
    ended: false,
    dismissed: false,
    hidden: false,
    autoplay: true,
};

test('up next shows inside the shared adaptive lead', () => {
    const card = tv.upNextCard(base);
    assert.equal(card?.next.id, 'e2');
    assert.equal(card?.leadSeconds, 53);
    assert.equal(card?.remainingSeconds, 30);
    assert.equal(card?.countdown, true);
    assert.equal(
        tv.upNextCard({ ...base, positionSeconds: 22 * 60 - 60 }),
        undefined
    );
});

test('up next starts at a supplied credits time', () => {
    const card = tv.upNextCard({
        ...base,
        positionSeconds: 22 * 60 - 100,
        creditsStartSeconds: 22 * 60 - 120,
    });
    assert.equal(card?.leadSeconds, 120);
});

test('up next needs an episode, a next one and a finite length', () => {
    assert.equal(tv.upNextCard({ ...base, next: undefined }), undefined);
    assert.equal(
        tv.upNextCard({ ...base, current: { ...current, kind: 'movie' } }),
        undefined
    );
    assert.equal(
        tv.upNextCard({ ...base, durationSeconds: Infinity }),
        undefined
    );
    assert.equal(tv.upNextCard({ ...base, durationSeconds: NaN }), undefined);
});

test('up next hides once ended, dismissed or covered', () => {
    assert.equal(tv.upNextCard({ ...base, ended: true }), undefined);
    assert.equal(tv.upNextCard({ ...base, dismissed: true }), undefined);
    assert.equal(tv.upNextCard({ ...base, hidden: true }), undefined);
});

test('up next drops the countdown when autoplay is off', () => {
    assert.equal(tv.upNextCard({ ...base, autoplay: false })?.countdown, false);
});

test('up next shows partial progress of the next episode only', () => {
    const progress = (seconds: number, extra: Partial<tv.Progress> = {}) => ({
        item: next,
        seconds,
        duration: 1000,
        updated: 1,
        ...extra,
    });
    assert.equal(
        tv.upNextCard({ ...base, nextProgress: progress(400) })
            ?.progressPercent,
        40
    );
    assert.equal(
        tv.upNextCard({ ...base, nextProgress: progress(0) })?.progressPercent,
        null
    );
    assert.equal(
        tv.upNextCard({
            ...base,
            nextProgress: progress(400, { watched: true }),
        })?.progressPercent,
        null
    );
});

test('up next countdown label and ring match the desktop card', () => {
    assert.equal(tv.upNextCountdownLabel(44.2), 'in 45 s');
    assert.equal(tv.upNextCountdownLabel(6 * 60 + 40), 'in 7 min');
    const card = tv.upNextCard(base);
    assert.ok(card);
    assert.equal(tv.upNextRingShare(card), 30 / 53);
    assert.equal(tv.upNextRingShare({ ...card, remainingSeconds: 0 }), 0);
});

test('a dismissal is keyed to this episode and its next one', () => {
    assert.notEqual(
        tv.upNextDismissKey(current, next),
        tv.upNextDismissKey(next, episode('e3', 1, 3))
    );
});

test('playerUpNextCard off hides the card but keeps the default on', () => {
    assert.equal(tv.upNextCard({ ...base, enabled: false }), undefined);
    assert.ok(tv.upNextCard({ ...base, enabled: true }));
    assert.ok(tv.upNextCard(base));
    assert.equal(tv.initialData().playerUpNextCard, true);
    assert.equal(tv.hydrateUserData({}).playerUpNextCard, true);
    assert.equal(
        tv.hydrateUserData({ playerUpNextCard: false }).playerUpNextCard,
        false
    );
});

test('the pill delay only runs while the card shows, like desktop', () => {
    const budget = new tv.UpNextCollapseBudget();
    assert.equal(budget.start('a', 0), UP_NEXT_COLLAPSE_DELAY_MS);
    budget.stop(4_000);
    assert.equal(budget.start('a', 60_000), UP_NEXT_COLLAPSE_DELAY_MS - 4_000);
    budget.stop(70_000);
    assert.equal(budget.start('a', 80_000), 0);
    budget.stop(80_000);
    assert.equal(budget.start('b', 90_000), UP_NEXT_COLLAPSE_DELAY_MS);
});

test('autoplay starts the next episode once, also when it loads after the end', () => {
    const state = {
        ended: true,
        autoplay: true,
        currentId: 'e1',
        hasNext: false,
        activating: false,
        advancedFrom: undefined as string | undefined,
    };
    assert.equal(tv.autoplayNextReady(state), false, 'next still loading');
    assert.equal(
        tv.autoplayNextReady({ ...state, hasNext: true }),
        true,
        'the late next episode still autoplays'
    );
    assert.equal(
        tv.autoplayNextReady({ ...state, hasNext: true, advancedFrom: 'e1' }),
        false,
        'never twice from the same episode'
    );
    assert.equal(
        tv.autoplayNextReady({ ...state, hasNext: true, activating: true }),
        false
    );
    assert.equal(
        tv.autoplayNextReady({ ...state, hasNext: true, autoplay: false }),
        false
    );
    assert.equal(
        tv.autoplayNextReady({ ...state, hasNext: true, ended: false }),
        false
    );
});
