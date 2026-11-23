import { readFileSync } from 'node:fs';

const { GH_TOKEN, PR_NUMBER, GITHUB_API_URL, GITHUB_REPOSITORY, GITHUB_EVENT_PATH } = process.env;
const repository = `${GITHUB_API_URL || 'https://api.github.com'}/repos/${GITHUB_REPOSITORY}`;
const configuration = new URL('../', import.meta.url);
const classes = ['low', 'medium', 'high'];

function configurationLines(file) {
  return readFileSync(new URL(file, configuration), 'utf8')
    .split(/\r?\n/)
    .map(line => line.replace(/\s+#.*$/, '').trim())
    .filter(line => line && !line.startsWith('#'));
}

function agents() {
  const [header, ...lines] = configurationLines('agents.yml');
  if (header !== 'agents:') throw new Error('Expected the agents registry.');
  const entries = [];
  for (const line of lines) {
    const field = /^(?:- (id)|(role|app|model)):\s*([a-z0-9-]+)$/.exec(line);
    if (!field) throw new Error('Invalid agent registry entry.');
    const [, id, property, value] = field;
    if (id) entries.push({ id: value });
    else entries.at(-1)[property] = value;
  }
  if (entries.some(entry => !entry.app || !entry.model ||
      !['orchestrator', 'implementer', 'validator'].includes(entry.role))) {
    throw new Error('Each agent needs an App, a model and a recognised role.');
  }
  return entries;
}

function glob(pattern) {
  const expression = pattern.match(/\*\*\/|\*\*|\*|\?|./g).map(part => {
    if (part === '**/') return '(?:.*/)?';
    if (part === '**') return '.*';
    if (part === '*') return '[^/]*';
    if (part === '?') return '[^/]';
    return part.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
  }).join('');
  return new RegExp(`^${expression}$`, 's');
}

function riskPaths() {
  const paths = { high: [], medium: [], low: [] };
  let fallback;
  let section;
  for (const line of configurationLines('risk-paths.yml')) {
    if (/^(high|medium|low):$/.test(line)) {
      section = line.slice(0, -1);
    } else if (/^default: (low|medium|high)$/.test(line)) {
      fallback = line.split(' ')[1];
      section = undefined;
    } else if (section && line.startsWith('- ')) {
      const pattern = line.slice(2).replace(/^(['"])(.*)\1$/, '$2');
      paths[section].push(glob(pattern));
    } else {
      throw new Error('Invalid risk path configuration.');
    }
  }
  if (!fallback) throw new Error('The risk path configuration needs a default class.');
  return { paths, fallback };
}

async function request(url) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${GH_TOKEN}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!response.ok) throw new Error(`GitHub API returned ${response.status} for ${new URL(url).pathname}.`);
  return response;
}

async function pages(path) {
  const items = [];
  let url = repository + path;
  while (url) {
    const response = await request(url);
    items.push(...await response.json());
    url = response.headers.get('link')?.match(/<([^>]+)>; rel="next"/)?.[1];
  }
  return items;
}

async function main() {
  if (!GH_TOKEN || !GITHUB_REPOSITORY || !/^\d+$/.test(PR_NUMBER || '')) {
    throw new Error('Set GH_TOKEN, GITHUB_REPOSITORY and PR_NUMBER.');
  }

  const pullPath = `/pulls/${PR_NUMBER}`;
  const pull = await (await request(repository + pullPath)).json();
  const registered = agents();
  const agentFor = (user, role) => (user?.type === 'Bot' && registered.find(agent =>
    agent.role === role && `${agent.app}[bot]`.toLowerCase() === user.login.toLowerCase())) || undefined;

  const author = agentFor(pull.user, 'implementer');
  if (!author) throw new Error('The pull request author is not a registered Implementer.');

  const eventHead = GITHUB_EVENT_PATH &&
    JSON.parse(readFileSync(GITHUB_EVENT_PATH, 'utf8')).pull_request?.head.sha;
  if (eventHead && eventHead !== pull.head.sha) throw new Error('The pull request head changed after this run was queued.');

  const { paths, fallback } = riskPaths();
  const files = await pages(`${pullPath}/files?per_page=100`);
  if (files.length !== pull.changed_files) throw new Error('GitHub did not return every changed path.');
  const classify = path => [...classes].reverse().find(risk =>
    paths[risk].some(pattern => pattern.test(path))) || fallback;
  const changedPaths = files.flatMap(file => [file.filename, file.previous_filename].filter(Boolean));
  const risk = pull.labels.some(label => label.name === 'risk:high') ? 'high'
    : classes[Math.max(0, ...changedPaths.map(path => classes.indexOf(classify(path))))];
  console.log(`Risk class: ${risk}`);
  if (risk === 'low') return;

  const reviews = await pages(`${pullPath}/reviews?per_page=100`);
  // Only a Validator that runs on a different model from the author can give a PASS or a FAIL.
  const independent = review => {
    const validator = agentFor(review.user, 'validator');
    return validator && validator.model !== author.model;
  };
  const latest = reviews.filter(review => review.submitted_at && independent(review))
    .sort((left, right) => Date.parse(right.submitted_at) - Date.parse(left.submitted_at) || right.id - left.id)[0];
  if (latest?.state !== 'APPROVED' || latest.commit_id !== pull.head.sha) {
    throw new Error('The latest review by a Validator on a different model from the author must approve the current commit.');
  }

  if (risk === 'high') {
    const query = new URLSearchParams({ check_name: 'e2e', filter: 'latest', per_page: '100' });
    const checks = await (await request(`${repository}/commits/${pull.head.sha}/check-runs?${query}`)).json();
    const latestCheck = checks.check_runs.filter(check => check.name === 'e2e' && check.head_sha === pull.head.sha)
      .sort((left, right) => right.id - left.id)[0];
    if (latestCheck?.status !== 'completed' || latestCheck.conclusion !== 'success') {
      throw new Error('High risk requires a successful e2e check on the current commit.');
    }
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
