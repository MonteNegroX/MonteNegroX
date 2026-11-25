import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProfile, groupContributions, load, onlyStampChanged, plain } from '../scripts/build-profile.mjs';
import { summarizeActivity } from '../scripts/lib/profile-activity.mjs';

test('plain strips em and en dashes', () => {
	assert.equal(plain('AI — Web3–Dev'), 'AI: Web3-Dev');
});

test('load filters private and archived repos and puts original repos first', () => {
	const loaded = load([
		{ name: 'MonteNegroX', isPrivate: false, isFork: false, isArchived: false, stargazerCount: 0 },
		{ name: 'secret', isPrivate: true, isFork: false, isArchived: false, stargazerCount: 10 },
		{ name: 'old', isPrivate: false, isFork: false, isArchived: true, stargazerCount: 5 },
		{ name: 'forked', isPrivate: false, isFork: true, isArchived: false, stargazerCount: 0, diskUsage: 500 },
		{ name: 'own', isPrivate: false, isFork: false, isArchived: false, stargazerCount: 1, diskUsage: 100 },
	]);
	assert.deepEqual(loaded.map((r) => r.name), ['own', 'forked']);
});

test('groupContributions groups merged PRs by external repository sorted by stars', () => {
	const grouped = groupContributions([
		{ number: 1, url: 'https://github.com/a/b/pull/1', mergedAt: '2026-08-01T00:00:00Z', repository: { nameWithOwner: 'a/b', url: 'https://github.com/a/b', description: 'A', stargazerCount: 10, isPrivate: false } },
		{ number: 2, url: 'https://github.com/c/d/pull/2', mergedAt: '2026-09-01T00:00:00Z', repository: { nameWithOwner: 'c/d', url: 'https://github.com/c/d', description: 'C', stargazerCount: 500, isPrivate: false } },
		{ number: 3, url: 'https://github.com/MonteNegroX/own/pull/3', mergedAt: '2026-09-01T00:00:00Z', repository: { nameWithOwner: 'MonteNegroX/own', url: 'https://github.com/MonteNegroX/own', description: '', stargazerCount: 99, isPrivate: false } },
	]);
	assert.equal(grouped.length, 2);
	assert.equal(grouped[0].name, 'c/d');
	assert.equal(grouped[1].name, 'a/b');
});

test('onlyStampChanged ignores date-stamp-only diffs', () => {
	const a = 'Pulled from the GitHub API on November 24, 2026.\nHello';
	const b = 'Pulled from the GitHub API on November 25, 2026.\nHello';
	assert.equal(onlyStampChanged(a, b), true);
	assert.equal(onlyStampChanged(a, `${b}!`), false);
});

test('buildProfile generates README, metadata, and dual-theme SVGs', () => {
	const repos = [
		{ name: 'frame-ambassadors', description: 'Agentic KOL campaign platform with Solana escrow', stargazerCount: 1, isFork: false, topics: [], language: 'TypeScript', createdAt: '2026-05-03T10:50:42Z', diskUsage: 500 },
		{ name: 'OmniRoute', description: 'Free MIT AI gateway', stargazerCount: 0, isFork: true, topics: [], language: 'TypeScript', createdAt: '2026-07-22T22:26:57Z', diskUsage: 900 },
	];
	const contributions = [
		{ name: 'cheaper-inference/OmniRoute', url: 'https://github.com/cheaper-inference/OmniRoute', description: 'AI gateway', stargazerCount: 90309, prs: [{ number: 8217, url: 'https://github.com/cheaper-inference/OmniRoute/pull/8217', mergedAt: '2026-07-23T11:44:49Z' }] },
	];
	const activityData = {
		owner: 'MonteNegroX',
		fetchedAt: '2026-11-25T21:00:00Z',
		calendar: [['2026-11-24', 3], ['2026-11-25', 2]],
		commits: { 'frame-ambassadors': [[Date.parse('2026-11-24T12:00:00Z'), 120, 30, 'abc123']] },
	};
	const out = buildProfile(repos, { activityData, contributions, now: new Date('2026-11-25T21:00:00Z') });
	assert.match(out.readme, /<h1 align="center">pazhik<\/h1>/);
	assert.match(out.readme, /Open-source contributions/);
	assert.match(out.readme, /How I build/);
	assert.ok(out.assets['stats-dark.svg'].includes('<svg'));
	assert.ok(out.assets['planet-light.svg'].includes('<svg'));
	assert.ok(out.assets['activity-calendar-dark.svg'].includes('<svg'));
	assert.equal(summarizeActivity(activityData, { now: new Date('2026-11-25T21:00:00Z') }).totals.currentStreak, 2);
});
