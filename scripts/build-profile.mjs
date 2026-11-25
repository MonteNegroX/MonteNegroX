#!/usr/bin/env node
// Generate the github.com/MonteNegroX profile repository:
// a personal README with animated 3D charts of the account (rendered by
// lib/profile-visuals.mjs into assets/), live coding analytics, merged PRs,
// public repository catalog grouped by topic, and agent-readable metadata
// (AGENTS.md, llms.txt, llms-full.txt, repos.json, CITATION.cff).
//
//   node scripts/build-profile.mjs                    # regenerate the files in this checkout
//   node scripts/build-profile.mjs --out /tmp/profile # write them somewhere else
//   node scripts/build-profile.mjs --publish          # regenerate here, commit and push
//   node scripts/build-profile.mjs --no-activity      # skip the commit-history crawl
//
// Auth: gh must be authenticated (or GH_TOKEN set).

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectActivity, summarizeActivity } from './lib/profile-activity.mjs';
import { renderActivityVisuals, renderVisuals } from './lib/profile-visuals.mjs';

export const OWNER = 'MonteNegroX';
export const DISPLAY_NAME = 'pazhik';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const SOCIALS = {
	github: `https://github.com/${OWNER}`,
	x: 'https://twitter.com/pazhik_ido',
	linkedin: 'https://linkedin.com/in/eremenko-defi',
	youtube: 'https://www.youtube.com/@cryptoXforest',
};

export function plain(text = '') {
	return String(text).replace(/\s[\u2014\u2013]\s/g, ': ').replace(/[\u2014\u2013]/g, '-');
}

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n) => {
	const i = args.indexOf(`--${n}`);
	return i === -1 ? null : args[i + 1];
};
const OUT = resolve(opt('out') || ROOT);

const gh = (a, input) => execFileSync('gh', a, { encoding: 'utf8', input, maxBuffer: 1 << 28, stdio: ['pipe', 'pipe', 'pipe'] });

const CATEGORIES = [
	['Original projects', 'Built from scratch: agentic platforms, Solana escrow, and consumer on-chain applications.', (r) => !r.isFork],
	['DeFi & on-chain tooling', 'Protocol adapters, TVL/fee indexers, and on-chain agent tooling.', (r) => /defillama|dimension-adapter|milkymom/i.test(r.name) || has(r, ['defi', 'solana', 'web3', 'onchain'])],
	['AI agents & memory', 'Autonomous coding agents, context databases, skills, and multi-agent hubs.', (r) => /agent|hermes|aider|deepseek|researcher|viking|memory|skill|octop|omniroute|librechat|pi-web|canvastty|wrenai/i.test(r.name)],
	['Browser automation & scraping', 'Browser agent SDKs, web scraping APIs, and code intelligence tooling.', (r) => /browser|stagehand|ego-lite|firecrawl|markitdown|code-review-graph/i.test(r.name)],
	['Local inference & self-hosted', 'Local LLM runtimes, self-hosted dashboards, PaaS, and native tools.', (r) => /llama|airllm|coolify|memos|worldmonitor|openlogi|moneyprinter/i.test(r.name)],
	['Gaming & experiments', 'Game economy simulators and early web experiments.', () => true],
];

const STAMP = /^Pulled from the GitHub API on [A-Z][a-z]+ \d{1,2}, \d{4}\./gm;
const DATED = ['README.md', 'llms-full.txt'];
export function onlyStampChanged(before, after) {
	return before !== after && before.replace(STAMP, '') === after.replace(STAMP, '');
}

function has(r, topics) {
	return (r.topics || []).some((t) => topics.includes(t));
}

const stars = (n) => (n ? ` ★${n}` : '');
const clip = (s = '', n = 140) => {
	const t = plain(s).replace(/\s+/g, ' ').trim();
	if (t.length <= n) return t;
	const cut = t.slice(0, n);
	return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 20)).replace(/[\s,;:(-]+$/, '')}...`;
};
const repoDesc = (r) => {
	if (r.description) return clip(r.description);
	if (r.name === 'gacha-capsule') return 'Next.js site and pack worker for Capsule: $25 graded packs & Garage Packs with USDG on Robinhood Chain and USDC on Hyperliquid.';
	if (r.name === 'DefiLlama-Adapters') return 'Fork for contributing DeFiLlama TVL adapters (merged Capsule TVL adapter on Robinhood Chain).';
	if (r.name === 'dimension-adapters') return 'Fork for contributing DeFiLlama fees & volume adapters (merged Capsule adapter on Robinhood Chain).';
	return '';
};
const line = (r) => {
	const d = repoDesc(r);
	const tag = r.isFork ? ' _(fork)_' : '';
	return `- [${r.name}](https://github.com/${OWNER}/${r.name})${stars(r.stargazerCount)}${tag}${d ? `: ${d}` : ''}`;
};

const listRepos = () =>
	JSON.parse(gh(['repo', 'list', OWNER, '--limit', '1000', '--json', 'name,description,stargazerCount,isPrivate,isFork,isArchived,repositoryTopics,primaryLanguage,homepageUrl,pushedAt,createdAt,forkCount,diskUsage']));

export function load(rows) {
	return rows
		.filter((r) => !r.isPrivate && !r.isArchived && r.name !== OWNER)
		.map((r) => ({ ...r, topics: (r.repositoryTopics || []).map((t) => t.name), language: r.primaryLanguage?.name || null }))
		.sort((a, b) => Number(a.isFork) - Number(b.isFork) || b.stargazerCount - a.stargazerCount || (b.diskUsage || 0) - (a.diskUsage || 0) || a.name.localeCompare(b.name));
}

const CONTRIBUTIONS_QUERY = `query($q: String!, $endCursor: String) {
	search(query: $q, type: ISSUE, first: 100, after: $endCursor) {
		pageInfo { hasNextPage endCursor }
		nodes { ... on PullRequest { number url mergedAt repository { nameWithOwner url description stargazerCount isPrivate } } }
	}
}`;

function loadContributions() {
	const out = gh(['api', 'graphql', '--paginate', '-f', `query=${CONTRIBUTIONS_QUERY}`, '-f', `q=is:pr is:merged author:${OWNER} -user:${OWNER}`, '--jq', '.data.search.nodes[]']);
	return groupContributions(out.split('\n').filter(Boolean).map((l) => JSON.parse(l)));
}

export function groupContributions(prs) {
	const byRepo = new Map();
	for (const pr of prs) {
		const r = pr.repository;
		if (!r || r.isPrivate || r.nameWithOwner.toLowerCase().startsWith(`${OWNER.toLowerCase()}/`)) continue;
		if (!byRepo.has(r.nameWithOwner)) byRepo.set(r.nameWithOwner, { name: r.nameWithOwner, url: r.url, description: r.description || '', stargazerCount: r.stargazerCount, prs: [] });
		byRepo.get(r.nameWithOwner).prs.push({ number: pr.number, url: pr.url, mergedAt: pr.mergedAt });
	}
	const list = [...byRepo.values()];
	for (const c of list) c.prs.sort((a, b) => a.number - b.number);
	return list.sort((a, b) => b.stargazerCount - a.stargazerCount || a.name.localeCompare(b.name));
}

const lines = (n) => n.toLocaleString('en-US');
const longDate = (d) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : 'N/A');

function contributionsSection(list) {
	const prCount = list.reduce((n, c) => n + c.prs.length, 0);
	const firstYear = list.flatMap((c) => c.prs.map((p) => p.mergedAt)).sort()[0].slice(0, 4);
	const row = (c) => `- [${c.name}](${c.url})${stars(c.stargazerCount)}, merged ${c.prs.map((p) => `[#${p.number}](${p.url})`).join(', ')}${c.description ? `: ${clip(c.description)}` : ''}`;
	return `
## Open-source contributions

${lines(prCount)} merged pull ${prCount === 1 ? 'request' : 'requests'} in ${list.length} ${list.length === 1 ? 'repository' : 'repositories'} maintained by other people and teams, since ${firstYear}. Every pull request I authored that a maintainer merged outside my own account, read live from GitHub.

<details open>
<summary>${list.length} ${list.length === 1 ? 'repository' : 'repositories'}</summary>

${list.map(row).join('\n')}

</details>
`;
}

function activitySection(a, pic) {
	const rows = a.topRepos.map((r) => `| [${r.name}](https://github.com/${OWNER}/${r.name}) | ${lines(r.commits)} | ${lines(r.added)} | ${lines(r.removed)} |`);
	const records = [
		a.totals.busiest.date ? `- Busiest day: ${longDate(a.totals.busiest.date)} with ${lines(a.totals.busiest.count)} contributions.` : null,
		a.records.biggestDay.date ? `- Biggest day for lines: ${longDate(a.records.biggestDay.date)} with ${lines(a.records.biggestDay.lines)} lines changed.` : null,
		a.records.longestDay.date ? `- Most hours with a push in one day: ${a.records.longestDay.hours} on ${longDate(a.records.longestDay.date)}.` : null,
		`- Last 30 days: ${lines(a.last30.commits)} contributions, ${lines(a.last30.added)} lines added and ${lines(a.last30.removed)} removed across ${a.last30.activeDays} active days.`,
		`- Current streak: ${a.totals.currentStreak} days. Longest: ${a.totals.longestStreak} days${a.totals.longestStreakEnd ? `, ending ${longDate(a.totals.longestStreakEnd)}` : ''}.`,
	].filter(Boolean);

	return `
## How I build

Pulled from the GitHub API on ${longDate(a.fetchedAt.slice(0, 10))}. Contribution counts and streaks include private repositories as counts only. Lines and hours come from public non-fork repositories, with any commit over 20,000 changed lines left out as a bulk import. Hours are not a stopwatch: a day counts each clock hour (UTC) in which at least one commit landed, so it cannot pass 24.

${pic('activity-volume', 'Contributions, lines added and lines removed over the last 12 months')}

${pic('activity-habit', 'Hours with a push, active days and longest streak')}

${pic('activity-calendar', 'Calendar of daily contributions for the last 365 days')}

${pic('activity-lines', 'Lines added and removed per month')}

${pic('activity-hours', 'Hours of the day with a push for each of the last 90 days')}

${pic('activity-rhythm', 'Punchcard of commits by weekday and hour')}

${records.join('\n')}
${
	rows.length
		? `
| Where the lines went | Commits | Added | Removed |
|---|---:|---:|---:|
${rows.join('\n')}`
		: ''
}
`;
}

export function buildProfile(allRepos, { activityData = null, contributions = null, now = new Date() } = {}) {
	const repos = allRepos;
	const ownRepos = repos.filter((r) => !r.isFork);
	const totalStars = repos.reduce((n, r) => n + r.stargazerCount, 0);
	const prCount = contributions ? contributions.reduce((n, c) => n + c.prs.length, 0) : 0;
	const featured = ownRepos.length ? ownRepos.slice(0, 6) : repos.slice(0, 6);
	const placed = new Set();
	const groups = CATEGORIES.map(([title, blurb, test], slot) => {
		const items = repos.filter((r) => !placed.has(r.name) && test(r));
		items.forEach((r) => placed.add(r.name));
		return { title, blurb, items, slot };
	}).filter((g) => g.items.length);

	const activity = activityData ? summarizeActivity(activityData, { now, allow: new Set(repos.map((r) => r.name)) }) : null;
	const assets = renderVisuals(repos, groups, { now, contributions, activity });
	if (activity) Object.assign(assets, renderActivityVisuals(activity));

	const pic = (name, alt) =>
		`<picture><source media="(prefers-color-scheme: dark)" srcset="./assets/${name}-dark.svg"/><source media="(prefers-color-scheme: light)" srcset="./assets/${name}-light.svg"/><img alt="${alt}" src="./assets/${name}-light.svg" width="100%"/></picture>`;
	const anchor = (t) => t.toLowerCase().replace(/[^a-z0-9 -]/g, '').trim().replace(/\s+/g, '-');

	const startHereItems = [
		...featured.map(line),
		...(contributions || []).slice(0, 4).map((c) => `- [${c.name}](${c.url})${stars(c.stargazerCount)}: merged ${c.prs.map((p) => `[#${p.number}](${p.url})`).join(', ')}${c.description ? `: ${clip(c.description, 110)}` : ''}`),
	];

	const readme = `<h1 align="center">${DISPLAY_NAME}</h1>

<p align="center"><b>I build AI agents, DeFi tooling, and on-chain applications (${OWNER}).</b><br/>${repos.length} public repositories (${ownRepos.length} original, ${repos.length - ownRepos.length} open-source forks) and ${prCount} merged upstream PRs.</p>

<p align="center">
<a href="${SOCIALS.github}?tab=followers"><img alt="Followers" src="https://img.shields.io/github/followers/${OWNER}?style=for-the-badge&logo=github&label=followers"/></a>
<a href="${SOCIALS.github}?tab=repositories"><img alt="Repositories" src="https://img.shields.io/badge/repositories-${repos.length}-6250d6?style=for-the-badge&logo=github"/></a>
<a href="${SOCIALS.x}"><img alt="X @pazhik_ido" src="https://img.shields.io/badge/X-@pazhik__ido-000000?style=for-the-badge&logo=x"/></a>
<a href="${SOCIALS.linkedin}"><img alt="LinkedIn" src="https://img.shields.io/badge/LinkedIn-eremenko--defi-0A66C2?style=for-the-badge&logo=linkedin"/></a>
<a href="${SOCIALS.youtube}"><img alt="YouTube @cryptoXforest" src="https://img.shields.io/badge/YouTube-@cryptoXforest-FF0000?style=for-the-badge&logo=youtube"/></a>
</p>

<p align="center">${pic('stats', `${repos.length} repositories, ${ownRepos.length} original, ${prCount} merged PRs`)}</p>

<p align="center">${pic('planet', `A rotating 3D planet with one point per repository, colored by section`)}</p>

## About

I'm **pazhik** ([@${OWNER}](${SOCIALS.github})), currently diving deep into **AI & Machine Learning**, **autonomous agents**, and **on-chain DeFi systems**.

I build full-stack TypeScript, Next.js, Python, and Web3 software across Solana and EVM ecosystems — from agentic KOL campaign platforms with Solana escrow ([frame-ambassadors](${SOCIALS.github}/frame-ambassadors)) to consumer pack-opening apps settled on Robinhood Chain and Hyperliquid ([gacha-capsule](${SOCIALS.github}/gacha-capsule)).

Alongside my own projects, I contribute to open-source AI and DeFi ecosystems, including merged adapters and translations for [DefiLlama](https://github.com/DefiLlama/DefiLlama-Adapters), [OmniRoute](https://github.com/cheaper-inference/OmniRoute), [worldmonitor](https://github.com/koala73/worldmonitor), [gpt-researcher](https://github.com/assafelovic/gpt-researcher), and [OpenLogi](https://github.com/AprilNEA/OpenLogi).

Core stack: **TypeScript**, **Python**, **React / Next.js**, **Node.js**, **Solana / EVM**, **Figma**, and **Unity**. You can also find me on [X (@pazhik_ido)](${SOCIALS.x}), [LinkedIn](${SOCIALS.linkedin}), and [YouTube (@cryptoXforest)](${SOCIALS.youtube}).

## Start here

${startHereItems.join('\n')}

${pic('top-stars', 'Open-source reach across external repositories with merged pull requests')}

## By the numbers

Every chart below is rendered from the live GitHub listing each time the catalog is rebuilt, so the numbers are always current.

${pic('city', 'An isometric city with one tower per repository, one district per section')}

${pic('growth', 'Cumulative repositories over time, stacked by section')}
${pic('languages', 'A spinning 3D donut of primary languages')}

${pic('punchcard', 'Punchcard of when repositories were created, by weekday and hour')}
${activity ? activitySection(activity, pic) : ''}${contributions?.length ? contributionsSection(contributions) : ''}
## Find your way

Jump to a section below, or read the machine-readable catalog in [repos.json](./repos.json).

${groups.map((g) => `- [${g.title}](#${anchor(g.title)}) (${g.items.length})`).join('\n')}

${groups
	.map(
		(g, i) => `## ${g.title}

${g.blurb}

<details${i < 2 ? ' open' : ''}>
<summary>${g.items.length} ${g.items.length === 1 ? 'repository' : 'repositories'}</summary>

${g.items.map(line).join('\n')}

</details>`,
	)
	.join('\n\n')}

## Say hi

If something here helped you, a star takes one click. [Follow @${OWNER}](${SOCIALS.github}) for new work, or reach out on [X (@pazhik_ido)](${SOCIALS.x}), [LinkedIn](${SOCIALS.linkedin}), or [YouTube](${SOCIALS.youtube}).

Coding agents and LLM tooling can read this profile directly: [AGENTS.md](./AGENTS.md), [llms.txt](./llms.txt) and [repos.json](./repos.json). Previous profile version is backed up in [README.backup.md](./README.backup.md).

<p align="center"><sub>Catalog and charts regenerated from the live GitHub listing: ${repos.length} repositories (${ownRepos.length} original), ${prCount} merged upstream PRs${totalStars ? `, ${totalStars} ${totalStars === 1 ? 'star' : 'stars'}` : ''}.</sub></p>
`;

	const llms = `# ${OWNER} (${DISPLAY_NAME})

> Software by ${DISPLAY_NAME} (@${OWNER}): AI agents, DeFi tooling, and on-chain applications. ${repos.length} public repositories (${ownRepos.length} original, ${repos.length - ownRepos.length} forks).

## Catalog

- [Full machine-readable list](https://github.com/${OWNER}/${OWNER}/blob/main/repos.json): name, description, topics, language, fork flag and stars for every repo
- [Human catalog](https://github.com/${OWNER}/${OWNER}#readme): grouped by topic

## Sections

${groups.map((g) => `- ${g.title}: ${g.items.length} repositories`).join('\n')}

## Original projects

${featured.map((r) => `- [${r.name}](https://github.com/${OWNER}/${r.name}): ${clip(repoDesc(r), 120)}`).join('\n')}
${
	contributions?.length
		? `
## Contributions

Repositories owned by others where ${OWNER} has merged pull requests:

${contributions.map((c) => `- [${c.name}](${c.url}): ${c.prs.length} merged`).join('\n')}
`
		: ''
}`;

	const agents = `# AGENTS.md

This repository is the profile and catalog for [${OWNER}](https://github.com/${OWNER}) (${DISPLAY_NAME}). Apart from the generator in \`scripts/\`, it holds generated markdown, SVG charts, and machine-readable metadata.

## How to use it

- Read [repos.json](repos.json) to find a repository by topic, language, fork status, or description.
- Do not guess at a repository that is not in \`repos.json\`. It may be private or retired.

## Regeneration

\`README.md\`, \`assets/\`, \`llms.txt\`, \`llms-full.txt\`, \`CITATION.cff\`, \`AGENTS.md\` and \`repos.json\` are generated by \`scripts/build-profile.mjs\`. Do not edit them by hand; update the generator and run \`npm run build\`. See [scripts/README.md](scripts/README.md).
`;

	const llmsFull = `${llms}\n---\n\n${readme}`;
	const citation = `cff-version: 1.2.0
message: If you use this software, please cite it as below.
title: "${OWNER}"
abstract: "Profile catalog and generated analytics for ${DISPLAY_NAME} (@${OWNER}): AI agents, DeFi tooling, and on-chain applications."
repository-code: "https://github.com/${OWNER}/${OWNER}"
url: "https://github.com/${OWNER}"
authors:
  - alias: ${OWNER}
    name: ${DISPLAY_NAME}
    website: "https://github.com/${OWNER}"
`;

	const json = repos.map((r) => ({
		name: r.name,
		url: `https://github.com/${OWNER}/${r.name}`,
		description: clip(repoDesc(r), 300),
		topics: r.topics,
		language: r.language,
		stars: r.stargazerCount,
		fork: r.isFork,
		homepage: r.homepageUrl || null,
	}));

	return { readme, llms, llmsFull, citation, agents, assets, json: `${JSON.stringify(json, null, '\t')}\n`, count: repos.length, stars: totalStars, groups };
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const listed = listRepos();
	const all = load(listed);
	const activityData = flag('no-activity')
		? null
		: await collectActivity({
				owner: OWNER,
				repos: listed.filter((r) => !r.isPrivate && !r.isFork && r.name !== OWNER).map((r) => ({ name: r.name, pushedAt: r.pushedAt })),
				cacheFile: resolve(opt('activity-cache') || join(process.env.TMPDIR || '/tmp', 'profile-activity-cache.json')),
				log: console.log,
			});
	const contributions = loadContributions();
	const out = buildProfile(all, { activityData, contributions });
	const owned = ['README.md', 'llms.txt', 'llms-full.txt', 'CITATION.cff', 'AGENTS.md', 'repos.json'];
	mkdirSync(OUT, { recursive: true });
	writeFileSync(join(OUT, 'README.md'), out.readme);
	writeFileSync(join(OUT, 'llms.txt'), out.llms);
	writeFileSync(join(OUT, 'llms-full.txt'), out.llmsFull);
	writeFileSync(join(OUT, 'CITATION.cff'), out.citation);
	writeFileSync(join(OUT, 'AGENTS.md'), out.agents);
	writeFileSync(join(OUT, 'repos.json'), out.json);
	const assetDir = join(OUT, 'assets');
	if (existsSync(assetDir)) for (const f of readdirSync(assetDir)) if (f.endsWith('.svg') && !out.assets[f]) rmSync(join(assetDir, f));
	mkdirSync(assetDir, { recursive: true });
	for (const [name, body] of Object.entries(out.assets)) writeFileSync(join(assetDir, name), body);
	console.log(`wrote ${out.count} repos in ${out.groups.length} sections to ${OUT}`);
	for (const g of out.groups) console.log(`  ${String(g.items.length).padStart(3)}  ${g.title}`);

	if (flag('publish')) {
		if (OUT !== ROOT) throw new Error('--publish commits the checkout the script lives in; drop --out');
		const run = (...a) => {
			const r = spawnSync('git', ['-c', 'credential.helper=', '-c', 'credential.helper=!gh auth git-credential', ...a], { cwd: ROOT, encoding: 'utf8' });
			if (r.status !== 0) throw new Error(`git ${a.join(' ')}: ${r.stderr}`);
			return r.stdout;
		};
		run('add', '-A', '--', ...owned, 'assets');
		const changed = run('diff', '--cached', '--name-only').trim().split('\n').filter(Boolean);
		const unchanged = !changed.length || changed.every((f) => DATED.includes(f) && onlyStampChanged(run('show', `HEAD:${f}`), readFileSync(join(ROOT, f), 'utf8')));
		if (unchanged) {
			run('reset', '--quiet', '--', ...owned, 'assets');
			run('checkout', '--', ...DATED);
			console.log('profile repo already up to date');
			process.exit(0);
		}
		run('commit', '--quiet', '-m', `docs: refresh profile catalog and charts (${out.count} public repositories)`);
		run('push', '--quiet', 'origin', 'HEAD:main');
		console.log(`published https://github.com/${OWNER}/${OWNER}`);
	}
}
