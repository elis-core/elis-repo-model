// Decides which agents to start. It reads the state of the repository on every run, so a
// missed event is picked up by the next run. Every dispatch is recorded first as a comment
// by the Orchestrator; those comments are the memory that prevents a second dispatch.
import { appendFileSync, readFileSync } from 'node:fs';

const { GH_TOKEN, GITHUB_REPOSITORY, GITHUB_API_URL, GITHUB_GRAPHQL_URL, GITHUB_OUTPUT } = process.env;
const repository = `${GITHUB_API_URL || 'https://api.github.com'}/repos/${GITHUB_REPOSITORY}`;
const configuration = new URL('../', import.meta.url);

const limits = {
  daily: Number(process.env.DAILY_LIMIT) || 20, // dispatches per day, all agents together
  review: 3, // pull requests out of draft at the same time
  attempts: { refine: 2, implement: 2, fix: 3, validate: 3 }, // per Issue or pull request
  retryAfter: 2 * 60 * 60 * 1000, // a dispatch with no visible result may be repeated after this
};
const short = { orchestrator: 'orc', implementer: 'imp', validator: 'val' };

function agents() {
  const lines = readFileSync(new URL('agents.yml', configuration), 'utf8').split(/\r?\n/)
    .map(line => line.replace(/\s+#.*$/, '').trim()).filter(line => line && !line.startsWith('#'));
  if (lines.shift() !== 'agents:') throw new Error('Expected the agents registry.');
  const entries = [];
  for (const line of lines) {
    const field = /^(?:- (id)|(role|app|model)):\s*([a-z0-9-]+)$/.exec(line);
    if (!field) throw new Error('Invalid agent registry entry.');
    if (field[1]) entries.push({ id: field[3] });
    else entries.at(-1)[field[2]] = field[3];
  }
  for (const entry of entries) {
    const name = /-(orc|imp|val)-(\d{2})$/.exec(entry.id);
    if (!entry.app || !entry.model || !short[entry.role] || name?.[1] !== short[entry.role]) {
      throw new Error(`Agent ${entry.id} needs an App, a model and a name that matches its role.`);
    }
    entry.environment = `agent-${name[1]}`;
    // names of the variable and the secret of the App: ORC_*, IMP_01_*, VAL_02_*
    entry.prefix = name[1] === 'orc' ? 'ORC' : `${name[1]}_${name[2]}`.toUpperCase();
  }
  return entries;
}

async function request(method, url, body) {
  const response = await fetch(url, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${GH_TOKEN}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: body && JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`GitHub API returned ${response.status} for ${method} ${new URL(url).pathname}.`);
  return response;
}

async function pages(path) {
  const items = [];
  let url = repository + path;
  while (url) {
    const response = await request('GET', url);
    items.push(...await response.json());
    url = response.headers.get('link')?.match(/<([^>]+)>; rel="next"/)?.[1];
  }
  return items;
}

async function graphql(query, variables) {
  const response = await request('POST', GITHUB_GRAPHQL_URL || 'https://api.github.com/graphql', { query, variables });
  const { data, errors } = await response.json();
  if (errors?.length) throw new Error(errors.map(error => error.message).join('\n'));
  return data;
}

async function main() {
  if (!GH_TOKEN || !GITHUB_REPOSITORY) throw new Error('Set GH_TOKEN and GITHUB_REPOSITORY.');
  const registered = agents();
  const login = agent => `${agent.app}[bot]`.toLowerCase();
  const agentFor = (user, role) => (user?.type === 'Bot' && registered.find(agent =>
    (!role || agent.role === role) && login(agent) === user.login.toLowerCase())) || undefined;
  const orchestrator = registered.find(agent => agent.role === 'orchestrator');
  if (!orchestrator) throw new Error('The registry has no Orchestrator.');

  const record = /^<!-- agent-dispatch (\{.*?\}) -->/;
  const records = comments => comments.filter(comment => comment.user.login.toLowerCase() === login(orchestrator))
    .flatMap(comment => {
      const found = record.exec(comment.body || '');
      return found ? [{ ...JSON.parse(found[1]), at: Date.parse(comment.created_at) }] : [];
    });
  const history = async number => records(await pages(`/issues/${number}/comments?per_page=100`));

  const midnight = new Date();
  midnight.setUTCHours(0, 0, 0, 0);
  const today = records(await pages(`/issues/comments?since=${midnight.toISOString()}&per_page=100`))
    .filter(entry => entry.at >= midnight.getTime() && entry.task !== 'escalate');
  let budget = limits.daily - today.length;
  const dispatches = [];

  async function escalate(number, past, reason) {
    if (past.some(entry => entry.task === 'escalate')) return;
    await request('POST', `${repository}/issues/${number}/comments`, {
      body: `<!-- agent-dispatch ${JSON.stringify({ task: 'escalate' })} -->\nAgent dispatch stopped here: ${reason} A decision from the PO is needed.`,
    });
    await request('POST', `${repository}/issues/${number}/labels`, { labels: ['needs-po'] });
  }

  // Returns true when the agent was dispatched now.
  async function dispatch(agent, task, number, key, past, details) {
    const same = past.filter(entry => entry.task === task);
    if (same.some(entry => entry.key === key && Date.now() - entry.at < limits.retryAfter)) return false;
    if (same.length >= limits.attempts[task]) {
      await escalate(number, past, `the limit of ${limits.attempts[task]} attempts to ${task} was reached.`);
      return false;
    }
    if (budget < 1) {
      console.log(`Daily limit reached; #${number} waits (${task}).`);
      return false;
    }
    budget -= 1;
    await request('POST', `${repository}/issues/${number}/comments`, {
      body: `<!-- agent-dispatch ${JSON.stringify({ task, agent: agent.id, key })} -->\n` +
        `Dispatched \`${agent.id}\` to ${task} (attempt ${same.length + 1} of ${limits.attempts[task]}).`,
    });
    dispatches.push({
      agent: agent.id, role: agent.role, model: agent.model, environment: agent.environment,
      prefix: agent.prefix, task, number, ...details,
    });
    console.log(`Dispatched ${agent.id} to ${task} #${number}.`);
    return true;
  }

  // Pull requests: fix red CI or a FAIL, or validate a commit that only lacks its review.
  const pulls = await pages('/pulls?state=open&per_page=100');
  const issueOf = pull => Number(/^[a-z][a-z0-9-]*\/([1-9]\d*)-/.exec(pull.head.ref)?.[1]);
  const busy = new Set();
  let inReview = 0;
  for (const pull of pulls) {
    const author = agentFor(pull.user, 'implementer');
    if (!author) continue;
    busy.add(author.id);
    if (pull.draft) continue;
    inReview += 1;

    const sha = pull.head.sha;
    const { check_runs: runs } = await (await request('GET', `${repository}/commits/${sha}/check-runs?per_page=100`)).json();
    const check = name => runs.filter(run => run.name === name).sort((left, right) => right.id - left.id)[0];
    const finished = (name, conclusion) => check(name)?.status === 'completed' && check(name).conclusion === conclusion;
    const review = (await pages(`/pulls/${pull.number}/reviews?per_page=100`))
      .filter(entry => entry.submitted_at && ['APPROVED', 'CHANGES_REQUESTED'].includes(entry.state) &&
        agentFor(entry.user, 'validator') && agentFor(entry.user, 'validator').model !== author.model)
      .sort((left, right) => Date.parse(right.submitted_at) - Date.parse(left.submitted_at) || right.id - left.id)[0];
    const current = review?.commit_id === sha ? review : undefined;
    const past = await history(pull.number);
    const details = { sha, ref: pull.head.ref, issue: issueOf(pull) || 0 };

    if (finished('ci', 'failure')) {
      await dispatch(author, 'fix', pull.number, `ci:${sha}`, past, details);
    } else if (current?.state === 'CHANGES_REQUESTED') {
      await dispatch(author, 'fix', pull.number, `review:${current.id}`, past, details);
    } else if (finished('ci', 'success') && finished('elis-gate', 'failure') && !current) {
      const validator = registered.find(agent => agent.role === 'validator' && agent.model !== author.model);
      if (validator) await dispatch(validator, 'validate', pull.number, sha, past, details);
      else await escalate(pull.number, past, `no Validator runs on a different model from \`${author.id}\`.`);
    }
  }

  // Issues: refine what is new, then start a free Implementer on what the PO authorised.
  const issues = (await pages('/issues?state=open&sort=created&direction=asc&per_page=100'))
    .filter(issue => !issue.pull_request);
  const waiting = [];
  for (const issue of issues) {
    const labels = issue.labels.map(label => label.name);
    // Issue text becomes agent input, so it must come from the organisation or from an agent.
    const trusted = ['OWNER', 'MEMBER', 'COLLABORATOR'].includes(issue.author_association) || agentFor(issue.user);
    if (!trusted || labels.includes('blocked') || labels.includes('needs-po')) continue;
    if (labels.includes('needs-refinement')) {
      await dispatch(orchestrator, 'refine', issue.number, 'refine', await history(issue.number), { issue: issue.number });
    } else if (labels.includes('ready') && !pulls.some(pull => issueOf(pull) === issue.number)) {
      const past = await history(issue.number);
      const started = past.filter(entry => entry.task === 'implement' && Date.now() - entry.at < limits.retryAfter);
      if (started.length) busy.add(started.at(-1).agent);
      else waiting.push({ issue, past });
    }
  }
  for (const { issue, past } of waiting) {
    if (inReview >= limits.review) {
      console.log(`Review holds ${inReview} pull requests; #${issue.number} waits.`);
      continue;
    }
    const free = registered.find(agent => agent.role === 'implementer' && !busy.has(agent.id));
    if (!free) {
      console.log(`No free Implementer; #${issue.number} waits.`);
      continue;
    }
    if (await dispatch(free, 'implement', issue.number, 'implement', past, { issue: issue.number })) {
      busy.add(free.id);
      await setAgentField(issue, free.id).catch(error => console.log(`::warning::Agent field not set: ${error.message}`));
    }
  }

  if (GITHUB_OUTPUT) {
    appendFileSync(GITHUB_OUTPUT, `dispatches=${JSON.stringify(dispatches)}\n` +
      `bots=${registered.map(agent => `${agent.app}[bot]`).join(',')}\n`);
  }
  console.log(`${dispatches.length} dispatched; ${Math.max(budget, 0)} left for today.`);
}

async function setAgentField(issue, agent) {
  const { node } = await graphql(`query ($id: ID!) {
    node(id: $id) {
      ... on Issue {
        projectItems(first: 20) {
          nodes { id project { id number field(name: "Agent") { ... on ProjectV2Field { id } } } }
        }
      }
    }
  }`, { id: issue.node_id });
  const item = node.projectItems.nodes.find(entry =>
    String(entry.project.number) === process.env.PROJECT_NUMBER && entry.project.field?.id);
  if (!item) return;
  await graphql(`mutation ($project: ID!, $item: ID!, $field: ID!, $value: String!) {
    updateProjectV2ItemFieldValue(input: {projectId: $project, itemId: $item, fieldId: $field, value: {text: $value}}) {
      projectV2Item { id }
    }
  }`, { project: item.project.id, item: item.id, field: item.project.field.id, value: agent });
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
