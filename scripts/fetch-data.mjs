// Pulls the public profile data the scenes are built from.
//   1. GraphQL (GITHUB_TOKEN in Actions, `gh auth token` locally)
//   2. Public fallback: the contribution-graph HTML fragment + REST repo list
// Everything is normalised into one small JSON document that the site also consumes.

import { execFileSync } from 'node:child_process';

const LEVELS = { NONE: 0, FIRST_QUARTILE: 1, SECOND_QUARTILE: 2, THIRD_QUARTILE: 3, FOURTH_QUARTILE: 4 };

const QUERY = `query($login:String!){
  user(login:$login){
    name bio location avatarUrl createdAt
    followers{totalCount} following{totalCount}
    repositories(first:100, ownerAffiliations:OWNER, privacy:PUBLIC, orderBy:{field:PUSHED_AT, direction:DESC}){
      totalCount
      nodes{ name description url stargazerCount forkCount isFork isArchived pushedAt createdAt diskUsage primaryLanguage{name color} }
    }
    contributionsCollection{
      totalCommitContributions totalPullRequestContributions totalIssueContributions totalRepositoryContributions
      contributionCalendar{ totalContributions weeks{ contributionDays{ date contributionCount contributionLevel weekday } } }
    }
  }
}`;

function findToken() {
  const env = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (env) return env;
  try {
    return execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch {
    return null;
  }
}

async function graphql(token, login) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { authorization: `bearer ${token}`, 'content-type': 'application/json', 'user-agent': 'chronosphere-build' },
    body: JSON.stringify({ query: QUERY, variables: { login } }),
  });
  if (!res.ok) throw new Error(`GraphQL HTTP ${res.status}`);
  const json = await res.json();
  if (json.errors?.length) throw new Error(`GraphQL: ${json.errors.map((e) => e.message).join('; ')}`);
  if (!json.data?.user) throw new Error('GraphQL: user not found');
  return json.data.user;
}

const repoRow = (n) => ({
  name: n.name,
  description: n.description ?? '',
  url: n.url,
  stars: n.stargazerCount ?? 0,
  forks: n.forkCount ?? 0,
  pushedAt: n.pushedAt,
  createdAt: n.createdAt,
  size: n.diskUsage ?? 0,
  lang: n.primaryLanguage?.name ?? null,
  langColor: n.primaryLanguage?.color ?? null,
  fork: !!n.isFork,
  archived: !!n.isArchived,
});

function fromGraphQL(u, login) {
  const cc = u.contributionsCollection;
  const weeks = cc.contributionCalendar.weeks.map((w) =>
    w.contributionDays.map((d) => ({ d: d.date, c: d.contributionCount, l: LEVELS[d.contributionLevel] ?? 0 })),
  );
  return {
    user: {
      login,
      name: u.name ?? login,
      bio: u.bio ?? '',
      location: u.location ?? '',
      avatarUrl: u.avatarUrl,
      createdAt: u.createdAt,
      followers: u.followers.totalCount,
      following: u.following.totalCount,
      publicRepos: u.repositories.totalCount,
    },
    contrib: {
      total: cc.contributionCalendar.totalContributions,
      commits: cc.totalCommitContributions,
      prs: cc.totalPullRequestContributions,
      issues: cc.totalIssueContributions,
      weeks,
    },
    repos: u.repositories.nodes.map(repoRow),
  };
}

/** The public contribution graph fragment: no token needed. */
export async function scrapeContributions(login) {
  const res = await fetch(`https://github.com/users/${login}/contributions`, { headers: { 'user-agent': 'chronosphere-build' } });
  if (!res.ok) throw new Error(`contributions HTML ${res.status}`);
  const html = await res.text();
  const tips = new Map();
  for (const m of html.matchAll(/<tool-tip[^>]*\bfor="([^"]+)"[^>]*>([^<]*)<\/tool-tip>/g)) {
    const n = /^(\d+)\s+contribution/.exec(m[2].trim());
    tips.set(m[1], n ? +n[1] : 0);
  }
  const cells = [];
  for (const m of html.matchAll(/<td\b[^>]*>/g)) {
    const tag = m[0];
    const date = /data-date="([^"]+)"/.exec(tag)?.[1];
    if (!date) continue;
    const id = /\bid="([^"]+)"/.exec(tag)?.[1];
    const level = +(/data-level="(\d)"/.exec(tag)?.[1] ?? 0);
    cells.push({ d: date, l: level, c: tips.get(id) ?? 0 });
  }
  if (!cells.length) throw new Error('contributions HTML: no cells parsed');
  cells.sort((a, b) => (a.d < b.d ? -1 : 1));
  const weeks = [];
  for (const c of cells) {
    const wd = new Date(c.d + 'T00:00:00Z').getUTCDay();
    if (wd === 0 || !weeks.length) weeks.push([]);
    weeks.at(-1).push(c);
  }
  return weeks;
}

export async function restRepos(login) {
  const res = await fetch(`https://api.github.com/users/${login}/repos?per_page=100&sort=pushed`, {
    headers: { 'user-agent': 'chronosphere-build', accept: 'application/vnd.github+json' },
  });
  if (!res.ok) throw new Error(`REST repos ${res.status}`);
  return (await res.json()).map((r) =>
    repoRow({
      ...r,
      stargazerCount: r.stargazers_count,
      forkCount: r.forks_count,
      isFork: r.fork,
      isArchived: r.archived,
      pushedAt: r.pushed_at,
      createdAt: r.created_at,
      diskUsage: r.size,
      primaryLanguage: r.language ? { name: r.language, color: null } : null,
    }),
  );
}

/** Returns the normalised profile document, preferring GraphQL. */
export async function fetchProfileData(login) {
  const token = findToken();
  const errors = [];
  let data = null;
  if (token) {
    try {
      data = fromGraphQL(await graphql(token, login), login);
      data.source = 'graphql';
    } catch (e) {
      errors.push(String(e.message ?? e));
    }
  }
  if (!data) {
    const [weeks, repos] = await Promise.all([scrapeContributions(login), restRepos(login)]);
    const total = weeks.flat().reduce((s, d) => s + d.c, 0);
    data = {
      user: { login, name: login, bio: '', location: '', followers: 0, following: 0, publicRepos: repos.length },
      contrib: { total, commits: total, prs: 0, issues: 0, weeks },
      repos,
      source: 'public-fallback',
    };
  }
  const days = data.contrib.weeks.flat();
  data.contrib.from = days[0].d;
  data.contrib.to = days.at(-1).d;
  data.schema = 1;
  data.generatedAt = new Date().toISOString();
  if (errors.length) data.notes = errors;
  return data;
}
