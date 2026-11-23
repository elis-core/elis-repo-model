import { setTimeout } from 'node:timers/promises';

const { GH_TOKEN, PROJECT_NUMBER, GITHUB_REPOSITORY_OWNER, GITHUB_GRAPHQL_URL } = process.env;
const endpoint = GITHUB_GRAPHQL_URL || 'https://api.github.com/graphql';

async function graphql(query, variables) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${GH_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok) throw new Error(`GraphQL request failed with HTTP ${response.status}.`);
  const { data, errors } = await response.json();
  if (errors?.length) throw new Error(errors.map(error => error.message).join('\n'));
  return data;
}

async function setLabel(issue, label, add) {
  const mutation = add ? 'addLabelsToLabelable' : 'removeLabelsFromLabelable';
  await graphql(`mutation ($issue: ID!, $label: ID!) {
    ${mutation}(input: {labelableId: $issue, labelIds: [$label]}) {
      labelable { __typename }
    }
  }`, { issue, label });
}

async function convert(item) {
  const name = item.product?.name?.trim().toLowerCase();
  if (!name) return;

  const target = `${GITHUB_REPOSITORY_OWNER}/${name}`;
  const { repository } = await graphql(`query ($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) {
      id
      label(name: "needs-refinement") { id }
      ready: label(name: "ready") { id }
    }
  }`, { owner: GITHUB_REPOSITORY_OWNER, name }).catch(error => {
    throw new Error(`Could not look up product repository ${target}: ${error.message}`);
  });
  if (!repository) throw new Error(`Product repository ${target} is missing or inaccessible.`);
  if (!repository.label || (item.status?.name === 'Ready' && !repository.ready)) {
    throw new Error(`Set up the intake labels in ${name} before converting its drafts.`);
  }

  const { convertProjectV2DraftIssueItemToIssue: result } = await graphql(`
    mutation ($item: ID!, $repository: ID!) {
      convertProjectV2DraftIssueItemToIssue(input: {itemId: $item, repositoryId: $repository}) {
        item { content { ... on Issue { id } } }
      }
    }
  `, { item: item.id, repository: repository.id });
  const issue = result.item.content.id;
  for (let attempt = 1; ; attempt++) {
    try {
      await setLabel(issue, repository.label.id, true);
      break;
    } catch (error) {
      if (attempt === 3) throw new Error(`Could not apply needs-refinement to converted Issue ${issue}: ${error.message}`);
      await setTimeout(attempt * 1000);
    }
  }
  if (item.status?.name === 'Ready') await setLabel(issue, repository.ready.id, true);
}

async function mirrorReady(issue, ready) {
  if (issue.repository.owner.login.toLowerCase() !== GITHUB_REPOSITORY_OWNER.toLowerCase()) return;
  const label = issue.repository.ready?.id;
  if (!label) {
    if (ready) throw new Error(`The ready label is missing in ${issue.repository.nameWithOwner}.`);
    return;
  }

  let labels = issue.labels;
  for (;;) {
    if (labels.nodes.some(node => node.id === label)) {
      if (!ready) await setLabel(issue.id, label, false);
      return;
    }
    if (!labels.pageInfo.hasNextPage) break;
    const { node } = await graphql(`query ($id: ID!, $cursor: String!) {
      node(id: $id) {
        ... on Issue {
          labels(first: 100, after: $cursor) { nodes { id } pageInfo { hasNextPage endCursor } }
        }
      }
    }`, { id: issue.id, cursor: labels.pageInfo.endCursor });
    labels = node.labels;
  }
  if (ready) await setLabel(issue.id, label, true);
}

async function main() {
  if (!GH_TOKEN || !GITHUB_REPOSITORY_OWNER || !/^[1-9]\d*$/.test(PROJECT_NUMBER || '')) {
    throw new Error('Set GH_TOKEN, GITHUB_REPOSITORY_OWNER and PROJECT_NUMBER.');
  }

  let cursor = null;
  let failed = false;
  do {
    const { organisation } = await graphql(`
      query ($owner: String!, $number: Int!, $cursor: String) {
        organisation: organization(login: $owner) {
          projectV2(number: $number) {
            items(first: 50, after: $cursor) {
              pageInfo { hasNextPage endCursor }
              nodes {
                id
                isArchived
                product: fieldValueByName(name: "Product") { ... on ProjectV2ItemFieldSingleSelectValue { name } }
                status: fieldValueByName(name: "Status") { ... on ProjectV2ItemFieldSingleSelectValue { name } }
                content {
                  __typename
                  ... on Issue {
                    id
                    repository { nameWithOwner owner { login } ready: label(name: "ready") { id } }
                    labels(first: 100) { nodes { id } pageInfo { hasNextPage endCursor } }
                  }
                }
              }
            }
          }
        }
      }
    `, { owner: GITHUB_REPOSITORY_OWNER, number: Number(PROJECT_NUMBER), cursor });
    const items = organisation?.projectV2?.items;
    if (!items) throw new Error('The organisation Project is unavailable.');
    for (const item of items.nodes) {
      try {
        if (item.content?.__typename === 'DraftIssue' && !item.isArchived) await convert(item);
        if (item.content?.__typename === 'Issue') {
          await mirrorReady(item.content, !item.isArchived && item.status?.name === 'Ready');
        }
      } catch (error) {
        console.error(`Project item ${item.id}: ${error.message}`);
        failed = true;
      }
    }
    cursor = items.pageInfo.hasNextPage ? items.pageInfo.endCursor : null;
  } while (cursor);
  if (failed) process.exitCode = 1;
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
