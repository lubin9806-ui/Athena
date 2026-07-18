const { signingCredentialsPresent, sourceState } = require('./release-common');

const source = sourceState();
const updateBaseUrl = process.env.ATHENA_UPDATE_BASE_URL?.trim() || '';
const publisher = process.env.ATHENA_SIGNING_PUBLISHER?.trim() || '';
const blockers = [];

if (!source.gitAvailable || source.commit === 'unknown') blockers.push('git-identity-unavailable');
if (!source.cleanCheckout) blockers.push(`checkout-dirty:${source.changedPathCount}`);
if (!signingCredentialsPresent()) blockers.push('code-signing-certificate-missing');
if (!publisher) blockers.push('signing-publisher-identity-missing');
if (!/^https:\/\//i.test(updateBaseUrl)) blockers.push('https-update-feed-missing');

console.log(`ATHENA_SIGNING_PREFLIGHT_SOURCE commit=${source.shortCommit} branch=${source.branch} clean=${source.cleanCheckout} git=${source.gitAvailable}`);
console.log(`ATHENA_SIGNING_PREFLIGHT_INPUTS certificate=${signingCredentialsPresent()} publisher=${Boolean(publisher)} httpsFeed=${/^https:\/\//i.test(updateBaseUrl)}`);

if (blockers.length) {
  console.error(`ATHENA_SIGNING_PREFLIGHT_BLOCKED ${blockers.join(',')}`);
  process.exit(2);
}

console.log('ATHENA_SIGNING_PREFLIGHT_OK signed-private-beta-build-may-start');
