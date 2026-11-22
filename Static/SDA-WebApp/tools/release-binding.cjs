'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const root = path.resolve(__dirname, '../../..');
const bindingPath = path.join(root, '.github/sda-website-release-bindings.json');
const evidencePrefix = 'Documentation/Projects/Working/logs/SDA-WEBAPP-MIG-01/release-evidence/';
const environments = ['dev', 'test', 'prod'];
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const digest = value => /^[a-f0-9]{64}$/.test(value || '');
const commit = value => /^[a-f0-9]{40}$/.test(value || '');
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
function requireValue(condition, message) { if (!condition) throw Error(message); }
function relativeFile(name, prefix = '') {
  requireValue(typeof name === 'string' && name.startsWith(prefix) && !name.includes('\\') && !path.posix.isAbsolute(name)
    && path.posix.normalize(name) === name && !name.split('/').some(part => !part || part === '..' || part === '.'), 'Unsafe release file path');
  return name;
}
function readOwned(name) {
  relativeFile(name, evidencePrefix);
  let current = root;
  for (const part of name.split('/')) {
    current = path.join(current, part);
    requireValue(!fs.lstatSync(current).isSymbolicLink(), 'Linked release evidence is forbidden');
  }
  requireValue(fs.lstatSync(current).isFile(), 'Release evidence must be a regular file');
  return fs.readFileSync(current);
}
function contextFromActions() {
  requireValue(process.env.GITHUB_EVENT_PATH, 'GitHub Actions event context required');
  const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH));
  return { repository: process.env.GITHUB_REPOSITORY, ref: process.env.GITHUB_REF, eventName: process.env.GITHUB_EVENT_NAME, inputs: event.inputs };
}
function validateContext(contract, environment, context) {
  requireValue(contract.version === 1 && contract.repository === 'B-D-D-B/PublishGraph.Foundation'
    && contract.workflowPath === '.github/workflows/deploy-sda-website.yml' && contract.allowedWorkflowRef === 'refs/heads/main', 'Unexpected service release contract');
  requireValue(JSON.stringify(Object.keys(contract.environments).sort()) === JSON.stringify([...environments].sort()), 'Only dev/test/prod bindings are permitted');
  requireValue(environments.includes(environment) && context.repository === contract.repository && context.ref === contract.allowedWorkflowRef
    && context.eventName === 'workflow_dispatch' && context.inputs && Object.keys(context.inputs).length === 1
    && context.inputs.environment === environment, 'Dispatch repository/ref/event/input is not permitted');
}
function receipt(descriptor, readFile) {
  requireValue(descriptor && typeof descriptor === 'object' && !Array.isArray(descriptor), 'Missing committed receipt descriptor');
  relativeFile(descriptor.path, evidencePrefix);
  const bytes = readFile(descriptor.path);
  const data = JSON.parse(bytes);
  requireValue(data && typeof data === 'object' && !Array.isArray(data), 'Release receipt must be a JSON object');
  return { bytes, data };
}
function acceptedReceipt(descriptor, kind, environment, binding, readFile, extra = {}) {
  const value = receipt(descriptor, readFile), data = value.data;
  requireValue(typeof descriptor.gateId === 'string' && descriptor.gateId && typeof descriptor.functionId === 'string' && descriptor.functionId
    && ['PASS', 'READY'].includes(descriptor.disposition) && data.disposition === descriptor.disposition
    && data.gateId === descriptor.gateId && data.functionId === descriptor.functionId && data.kind === kind
    && data.environment === environment && same(data.appId, binding.target.appId)
    && data.artifactSha256 === binding.artifact.zipSha256 && data.sourceCommit === binding.artifact.sourceCommit, 'Receipt gate/scope/environment/artifact acceptance mismatch');
  if (extra.passOnly) requireValue(data.disposition === 'PASS', 'A delivered-result PASS receipt is required');
  return value;
}
function resolveBinding(contract, environment, context, readFile = readOwned) {
  validateContext(contract, environment, context);
  const binding = contract.environments[environment];
  requireValue(binding !== null && typeof binding === 'object', 'INACTIVE: exact owner/environment/artifact/stage binding is unavailable');
  const known = contract.knownInfrastructure[environment], target = binding.target, oidc = binding.oidc, artifact = binding.artifact;
  requireValue(known && target && oidc && artifact && binding.receipts, 'Incomplete fixed release binding');
  requireValue(/^sda-(?:website-)?(?:dev|test|prod)$/.test(binding.githubEnvironment)
    && binding.githubEnvironment.endsWith('-' + environment), 'Unagreed GitHub environment binding');
  const expectedApp = `/subscriptions/${known.subscriptionId}/resourceGroups/${known.resourceGroup}/providers/Microsoft.Web/sites/${target.appName}`;
  requireValue(same(target.appId, expectedApp) && same(target.subscriptionId, known.subscriptionId) && target.resourceGroup === known.resourceGroup
    && same(target.planId, known.planId) && /^[a-z0-9-]+$/.test(target.appName) && /^[a-z0-9.-]+\.azurewebsites\.net$/.test(target.defaultHostname), 'Fixed infrastructure binding mismatch');
  for (const key of ['tenantId', 'clientId', 'principalId', 'roleDefinitionId']) requireValue(/^[a-f0-9-]{36}$/i.test(oidc[key] || ''), 'Missing actual deployment identity');
  requireValue(oidc.issuer === 'https://token.actions.githubusercontent.com' && oidc.audience === 'api://AzureADTokenExchange'
    && oidc.subject === `repo:${contract.repository}:environment:${binding.githubEnvironment}`, 'Fixed OIDC/FIC binding mismatch');
  requireValue(Number.isSafeInteger(artifact.runId) && artifact.runId > 0 && Number.isSafeInteger(artifact.id) && artifact.id > 0
    && typeof artifact.name === 'string' && /^[a-zA-Z0-9._-]+$/.test(artifact.name) && commit(artifact.sourceCommit)
    && digest(artifact.archiveSha256) && digest(artifact.zipSha256) && digest(artifact.packageReceiptSha256)
    && /^\.github\/workflows\/[a-zA-Z0-9._-]+\.ya?ml$/.test(artifact.producerWorkflowPath), 'Missing exact accepted Actions artifact provenance');
  const packet = acceptedReceipt(binding.receipts.ownerPacket, 'owner-hosting-packet', environment, binding, readFile);
  const auth = acceptedReceipt(binding.receipts.auth, 'auth-disposition', environment, binding, readFile, { passOnly: true });
  acceptedReceipt(binding.receipts.artifactAcceptance, 'artifact-acceptance', environment, binding, readFile, { passOnly: true });
  const owner = acceptedReceipt(binding.receipts.ownerReadiness, 'owner-stage-readiness', environment, binding, readFile);
  const domain = acceptedReceipt(binding.receipts.domainReadiness, 'domain-readiness', environment, binding, readFile);
  requireValue(domain.data.gateId === 'DOMAIN-01', 'DOMAIN-01 evidence is required before deployment');
  acceptedReceipt(binding.receipts.capacityReadiness, 'capacity-stage-readiness', environment, binding, readFile);
  const host = owner.data.hosting;
  requireValue(host && host.stack === 'DOTNETCORE|10.0' && host.alwaysOn === true && host.httpsOnly === true
    && ['1.2', '1.3'].includes(host.minimumTlsVersion) && host.ftpsState === 'Disabled'
    && host.startup === 'dotnet /home/site/wwwroot/SDA.Website.dll' && host.contentRoot === '/home/site/wwwroot/wwwroot'
    && host.aspnetcoreUrls === 'http://0.0.0.0:8080' && host.buildOnDeploy === false
    && host.ftpBasicPublishing === false && host.scmBasicPublishing === false, 'Actual owner host/settings/literal-false SCM evidence is incomplete');
  const prior = binding.receipts.priorEnvironment;
  requireValue(Array.isArray(prior), 'Prior environment stage evidence missing');
  const previous = environment === 'test' ? 'dev' : environment === 'prod' ? 'test' : null;
  requireValue(prior.length === (previous ? 2 : 0), 'Dev-to-Test-to-Prod stage evidence missing');
  if (previous) {
    const predecessor = contract.environments[previous];
    requireValue(predecessor && predecessor.artifact.zipSha256 === artifact.zipSha256
      && predecessor.artifact.sourceCommit === artifact.sourceCommit, 'Predecessor accepted a different immutable payload');
    for (const stage of ['default-host', 'custom-domain']) {
      const descriptor = prior.find(item => item.stage === stage);
      requireValue(descriptor && prior.filter(item => item.stage === stage).length === 1, 'Prior default-host/custom-domain evidence missing');
      const proof = acceptedReceipt(descriptor, 'environment-acceptance', previous, predecessor, readFile, { passOnly: true });
      requireValue(proof.data.stage === stage, 'Prior environment stage mismatch');
    }
  }
  const selection = { environment, repository: contract.repository, githubEnvironment: binding.githubEnvironment, binding,
    ownerPacketBase64: packet.bytes.toString('base64'), authReceiptBase64: auth.bytes.toString('base64') };
  require('./release-target.cjs').validatePacket(selection);
  return selection;
}
async function verifyGithub(selection, api) {
  const { repository, binding } = selection, artifact = binding.artifact;
  const run = await api(`/repos/${repository}/actions/runs/${artifact.runId}`);
  requireValue(run.id === artifact.runId && run.repository?.full_name === repository && run.status === 'completed' && run.conclusion === 'success'
    && run.head_sha === artifact.sourceCommit && run.path === artifact.producerWorkflowPath, 'Accepted artifact run metadata mismatch');
  const actual = await api(`/repos/${repository}/actions/artifacts/${artifact.id}`);
  requireValue(actual.id === artifact.id && actual.name === artifact.name && actual.expired === false
    && actual.digest === 'sha256:' + artifact.archiveSha256 && actual.workflow_run?.id === artifact.runId
    && actual.workflow_run?.head_sha === artifact.sourceCommit, 'Accepted immutable artifact metadata mismatch');
  const endpoint = `/repos/${repository}/environments/${encodeURIComponent(binding.githubEnvironment)}`;
  const environment = await api(endpoint);
  requireValue(environment.name === binding.githubEnvironment && environment.deployment_branch_policy?.custom_branch_policies === true
    && environment.deployment_branch_policy?.protected_branches === false, 'Preexisting reviewed GitHub environment policy missing');
  const policies = await api(endpoint + '/deployment-branch-policies');
  requireValue(policies.total_count === 1 && policies.branch_policies?.length === 1
    && policies.branch_policies[0].name === 'main' && policies.branch_policies[0].type === 'branch', 'GitHub environment must permit main branch only');
}
function verifyArtifact(selection, directory, fileSystem = fs) {
  const actual = fileSystem.readdirSync(directory).sort();
  requireValue(JSON.stringify(actual) === JSON.stringify(['package.json', 'website.zip']), 'Unexpected accepted artifact payload inventory');
  for (const name of actual) requireValue(fileSystem.lstatSync(path.join(directory, name)).isFile()
    && !fileSystem.lstatSync(path.join(directory, name)).isSymbolicLink(), 'Artifact links/directories are forbidden');
  const artifact = selection.binding.artifact, zip = fileSystem.readFileSync(path.join(directory, 'website.zip'));
  const receiptBytes = fileSystem.readFileSync(path.join(directory, 'package.json'));
  requireValue(sha(zip) === artifact.zipSha256 && sha(receiptBytes) === artifact.packageReceiptSha256, 'Accepted payload ZIP/receipt byte mismatch');
  const receipt = JSON.parse(receiptBytes);
  requireValue(receipt.package?.sha256 === artifact.zipSha256 && receipt.sourceCommit === artifact.sourceCommit, 'Payload receipt provenance mismatch');
  return { zipSha256: sha(zip), packageReceiptSha256: sha(receiptBytes) };
}
async function githubApi(endpoint) {
  requireValue(process.env.GITHUB_TOKEN, 'Read-only workflow GITHUB_TOKEN required; no alternate credential');
  const response = await fetch('https://api.github.com' + endpoint, { headers: { Authorization: 'Bearer ' + process.env.GITHUB_TOKEN, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }, signal: AbortSignal.timeout(20000) });
  requireValue(response.ok, 'GitHub metadata read unavailable: HTTP ' + response.status + '; activation blocked');
  return response.json();
}
function loadSelection(environment) { return resolveBinding(JSON.parse(fs.readFileSync(bindingPath)), environment, contextFromActions()); }
function argument(name) { const at = process.argv.indexOf(name); return at < 0 ? undefined : process.argv[at + 1]; }
async function main() {
  const environment = argument('--environment'), output = argument('--output');
  requireValue(output && !fs.existsSync(output), 'Fresh output receipt required');
  const selection = loadSelection(environment);
  if (process.argv.includes('--resolve')) await verifyGithub(selection, githubApi);
  else if (process.argv.includes('--verify-artifact')) verifyArtifact(selection, argument('--directory'));
  else throw Error('--resolve or --verify-artifact required');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(selection, null, 2) + '\n', { flag: 'wx' });
  if (process.env.GITHUB_OUTPUT && process.argv.includes('--resolve')) {
    const b = selection.binding;
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `github_environment=${b.githubEnvironment}\nartifact_id=${b.artifact.id}\nartifact_run_id=${b.artifact.runId}\nclient_id=${b.oidc.clientId}\ntenant_id=${b.oidc.tenantId}\nsubscription_id=${b.target.subscriptionId}\n`);
  }
}
module.exports = { resolveBinding, validateContext, verifyGithub, verifyArtifact, loadSelection, readOwned, sha };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
