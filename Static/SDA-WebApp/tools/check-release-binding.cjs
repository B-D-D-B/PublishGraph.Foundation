'use strict';
// Every complete binding, owner receipt, artifact and API response below is synthetic.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { resolveBinding, verifyGithub, verifyArtifact, readOwned, sha } = require('./release-binding.cjs');
const { argument, writeNew } = require('./common.cjs');
const bindingFile = path.resolve(__dirname, '../../../.github/sda-website-release-bindings.json');
const realContract = JSON.parse(fs.readFileSync(bindingFile));
const guid = digit => `${digit.repeat(8)}-${digit.repeat(4)}-${digit.repeat(4)}-${digit.repeat(4)}-${digit.repeat(12)}`;
const context = environment => ({ repository: realContract.repository, ref: 'refs/heads/main', eventName: 'workflow_dispatch', inputs: { environment } });
function fixture(stage = 'custom-domain') {
  const contract = structuredClone(realContract), files = new Map(), zip = Buffer.from('synthetic accepted ZIP byte fixture');
  const sourceCommit = 'a'.repeat(40), packageBytes = Buffer.from(JSON.stringify({ sourceCommit, package: { sha256: sha(zip) } }));
  function put(environment, name, data, disposition = data.disposition) {
    const file = `Documentation/Projects/Working/logs/SDA-WEBAPP-MIG-01/release-evidence/fixture/${environment}/${name}.json`;
    const bytes = Buffer.from(JSON.stringify(data)); files.set(file, bytes);
    return { path: file, gateId: data.gateId, functionId: data.functionId, disposition };
  }
  for (const environment of ['dev', 'test', 'prod']) {
    const known = contract.knownInfrastructure[environment], appName = 'fixture-website-' + environment;
    const target = { subscriptionId: known.subscriptionId, resourceGroup: known.resourceGroup, planId: known.planId, appName,
      appId: `/subscriptions/${known.subscriptionId}/resourceGroups/${known.resourceGroup}/providers/Microsoft.Web/sites/${appName}`, defaultHostname: appName + '.azurewebsites.net' };
    const githubEnvironment = 'sda-website-' + environment;
    const oidc = { tenantId: guid('2'), clientId: guid('3'), principalId: guid('4'), roleDefinitionId: guid('5'), issuer: 'https://token.actions.githubusercontent.com', audience: 'api://AzureADTokenExchange', subject: `repo:${contract.repository}:environment:${githubEnvironment}` };
    const artifact = { runId: 100, id: 200, name: 'fixture-accepted-website', sourceCommit, archiveSha256: 'b'.repeat(64), zipSha256: sha(zip), packageReceiptSha256: sha(packageBytes), producerWorkflowPath: '.github/workflows/fixture-build.yml' };
    const base = kind => ({ kind, stage, environment, appId: target.appId, sourceCommit, artifactSha256: artifact.zipSha256, functionId: 'fixture-' + kind, gateId: 'fixture-' + kind, disposition: 'PASS' });
    const auth = put(environment, 'auth', base('auth-disposition'));
    const packet = { ...base('owner-hosting-packet'), version: 1, subscriptionId: known.subscriptionId, defaultHostname: target.defaultHostname,
      identity: { ...oidc, roleScope: target.appId },
      plan: { id: known.planId, observedSku: known.requiredSku, requiredSku: known.requiredSku, linux: true, region: 'westus3', capacity: 1, verifiedAtUtc: '2026-11-22T00:00:00Z' } };
    const owner = { ...base('owner-stage-readiness'), disposition: 'READY', hosting: { stack: 'DOTNETCORE|10.0', alwaysOn: true, httpsOnly: true, minimumTlsVersion: '1.2', ftpsState: 'Disabled', startup: 'dotnet /home/site/wwwroot/SDA.Website.dll', contentRoot: '/home/site/wwwroot/wwwroot', aspnetcoreUrls: 'http://0.0.0.0:8080', buildOnDeploy: false, ftpBasicPublishing: false, scmBasicPublishing: false } };
    contract.environments[environment] = { stage, githubEnvironment, target, oidc, artifact, receipts: { ownerPacket: put(environment, 'owner-packet', packet), auth,
      artifactAcceptance: put(environment, 'artifact', base('artifact-acceptance')), ownerReadiness: put(environment, 'owner', owner),
      domainReadiness: put(environment, 'domain', { ...base('domain-readiness'), gateId: 'DOMAIN-01' }),
      capacityReadiness: put(environment, 'capacity', { ...base('capacity-stage-readiness'), disposition: 'READY' }), priorEnvironment: [] } };
    if (stage === 'default-host') {
      files.delete(auth.path); files.delete(contract.environments[environment].receipts.domainReadiness.path);
      delete contract.environments[environment].receipts.auth; delete contract.environments[environment].receipts.domainReadiness;
    }
  }
  for (const environment of ['test', 'prod']) {
    const previous = environment === 'test' ? 'dev' : 'test', b = contract.environments[previous];
    contract.environments[environment].receipts.priorEnvironment = (stage === 'default-host' ? ['default-host'] : ['default-host', 'custom-domain']).map(stage => ({ ...put(previous, stage, {
      kind: 'environment-acceptance', environment: previous, appId: b.target.appId, artifactSha256: b.artifact.zipSha256, sourceCommit,
      stage, disposition: 'PASS', functionId: 'fixture-prior', gateId: 'fixture-' + stage }), stage }));
  }
  const read = name => { if (!files.has(name)) throw Error('Fixture receipt unavailable'); return files.get(name); };
  function changeReceipt(environment, name, modify) { const d = contract.environments[environment].receipts[name], data = JSON.parse(files.get(d.path)); modify(data); const bytes = Buffer.from(JSON.stringify(data)); files.set(d.path, bytes); }
  return { contract, files, read, changeReceipt, zip, packageBytes };
}
function apiFixture(selection, change) {
  const calls = [], b = selection.binding, a = b.artifact;
  return { calls, api: async endpoint => {
    calls.push(endpoint); let value;
    if (endpoint.includes('/actions/runs/')) value = { id: a.runId, repository: { full_name: selection.repository }, status: 'completed', conclusion: 'success', head_sha: a.sourceCommit, path: a.producerWorkflowPath };
    else if (endpoint.includes('/actions/artifacts/')) value = { id: a.id, name: a.name, expired: false, digest: 'sha256:' + a.archiveSha256, workflow_run: { id: a.runId, head_sha: a.sourceCommit } };
    else if (endpoint.endsWith('/deployment-branch-policies')) value = { total_count: 1, branch_policies: [{ name: 'main', type: 'branch' }] };
    else value = { name: b.githubEnvironment, deployment_branch_policy: { custom_branch_policies: true, protected_branches: false } };
    return change ? change(endpoint, value) : value;
  } };
}
async function run() {
  const rows = [], check = (name, pass, detail) => rows.push({ name, pass: !!pass, ...(pass ? {} : { detail }) });
  for (const environment of ['dev', 'test', 'prod']) {
    try { resolveBinding(realContract, environment, context(environment)); check('real-inactive:' + environment, false); }
    catch (error) { check('real-inactive:' + environment, error.message.startsWith('INACTIVE:')); }
    const f = fixture();
    try { const s = resolveBinding(f.contract, environment, context(environment), f.read), api = apiFixture(s); await verifyGithub(s, api.api); check('synthetic-fixed-complete:' + environment, api.calls.length === 4); }
    catch (error) { check('synthetic-fixed-complete:' + environment, false, error.message); }
  }
  for (const environment of ['dev', 'test', 'prod']) {
    const f = fixture('default-host');
    try {
      const s = resolveBinding(f.contract, environment, context(environment), f.read), api = apiFixture(s); await verifyGithub(s, api.api);
      check('default-host-without-auth-domain-customprior:' + environment, s.acceptanceScope === 'default-host-only' && !s.authReceiptBase64 && api.calls.length === 4
        && s.binding.receipts.priorEnvironment.length === (environment === 'dev' ? 0 : 1));
      check('default-host-explicit-gap-punchlist:' + environment, JSON.stringify(s.punchlist.map(x => x.id)) === JSON.stringify(['content-routes', 'oauth', 'vanity-domain-tls', 'availability'])
        && s.punchlist.every(x => typeof x.meaning === 'string' && x.meaning.length > 0));
    } catch (error) { check('default-host-without-auth-domain-customprior:' + environment, false, error.message); }
  }
  function rejectStage(name, modify, stage = 'default-host', environment = 'test') {
    const f = fixture(stage); modify(f, environment);
    try { resolveBinding(f.contract, environment, context(environment), f.read); check('stage-reject:' + name, false); }
    catch { check('stage-reject:' + name, true); }
  }
  rejectStage('unknown-stage', (f, env) => { f.contract.environments[env].stage = 'anything'; });
  rejectStage('missing-stage', (f, env) => { delete f.contract.environments[env].stage; });
  for (const control of ['ownerPacket', 'ownerReadiness', 'artifactAcceptance', 'capacityReadiness']) {
    rejectStage('cross-stage:' + control, (f, env) => f.changeReceipt(env, control, data => { data.stage = 'custom-domain'; }));
    rejectStage('missing-default-control:' + control, (f, env) => { delete f.contract.environments[env].receipts[control]; });
  }
  rejectStage('missing-prior-default', (f, env) => { f.contract.environments[env].receipts.priorEnvironment = []; });
  rejectStage('wrong-prior-stage', (f, env) => { f.contract.environments[env].receipts.priorEnvironment[0].stage = 'custom-domain'; });
  rejectStage('duplicate-prior-default', (f, env) => { const list = f.contract.environments[env].receipts.priorEnvironment; list.push(list[0]); });
  rejectStage('prior-proof-stage-mismatch', (f, env) => { const d = f.contract.environments[env].receipts.priorEnvironment[0], data = JSON.parse(f.files.get(d.path)); data.stage = 'custom-domain'; f.files.set(d.path, Buffer.from(JSON.stringify(data))); });
  rejectStage('prior-proof-wrong-environment', (f, env) => { const d = f.contract.environments[env].receipts.priorEnvironment[0], data = JSON.parse(f.files.get(d.path)); data.environment = 'prod'; f.files.set(d.path, Buffer.from(JSON.stringify(data))); });
  rejectStage('different-prior-zip', f => { f.contract.environments.dev.artifact.zipSha256 = 'f'.repeat(64); });
  rejectStage('different-prior-source', f => { f.contract.environments.dev.artifact.sourceCommit = 'f'.repeat(40); });
  rejectStage('custom-still-needs-auth', (f, env) => { delete f.contract.environments[env].receipts.auth; }, 'custom-domain');
  rejectStage('custom-still-needs-domain', (f, env) => { delete f.contract.environments[env].receipts.domainReadiness; }, 'custom-domain');
  rejectStage('custom-still-needs-prior-custom', (f, env) => { f.contract.environments[env].receipts.priorEnvironment.pop(); }, 'custom-domain');
  for (const stage of ['default-host', 'custom-domain']) {
    rejectStage('F01-unrelated-selected-host:' + stage, (f, env) => { f.contract.environments[env].target.defaultHostname = 'unrelated-host.azurewebsites.net'; }, stage);
    rejectStage('F01-missing-owner-host:' + stage, (f, env) => f.changeReceipt(env, 'ownerPacket', data => { delete data.defaultHostname; }), stage);
    rejectStage('F01-wrong-owner-host:' + stage, (f, env) => f.changeReceipt(env, 'ownerPacket', data => { data.defaultHostname = 'unrelated-host.azurewebsites.net'; }), stage);
  }
  for (const variant of ['formatting', 'legacy-optional-hashes']) {
    const f = fixture();
    if (variant === 'formatting') for (const [file, bytes] of f.files) f.files.set(file, Buffer.from(JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(bytes)).reverse()), null, 4) + '\n'));
    else for (const binding of Object.values(f.contract.environments)) {
      for (const descriptor of [...Object.values(binding.receipts).filter(value => !Array.isArray(value)), ...binding.receipts.priorEnvironment]) descriptor.sha256 = 'legacy-ignored-control-hash';
      f.changeReceipt(binding.githubEnvironment.split('-').pop(), 'ownerPacket', packet => { packet.authDispositionSha256 = 'ignored'; packet.identity.mappingEvidenceSha256 = 'ignored'; packet.plan.verificationEvidenceSha256 = 'ignored'; });
    }
    try { for (const environment of ['dev', 'test', 'prod']) resolveBinding(f.contract, environment, context(environment), f.read); check('hashless-control-positive:' + variant, true); }
    catch (error) { check('hashless-control-positive:' + variant, false, error.message); }
  }
  for (const [name, stat] of [['link', { isSymbolicLink: () => true }], ['nonfile', { isSymbolicLink: () => false, isFile: () => false }]]) {
    const original = fs.lstatSync; fs.lstatSync = () => stat;
    try { readOwned('Documentation/Projects/Working/logs/SDA-WEBAPP-MIG-01/release-evidence/synthetic.json'); check('control-file-reject:' + name, false); }
    catch (error) { check('control-file-reject:' + name, /Linked|regular file/.test(error.message)); }
    finally { fs.lstatSync = original; }
  }
  function reject(name, modify, expected = /./, environment = 'dev', ctx = context(environment)) {
    const f = fixture(); modify(f);
    try { resolveBinding(f.contract, environment, ctx, f.read); check(name, false, 'Invalid binding accepted'); }
    catch (error) { check(name, expected.test(error.message), error.message); }
  }
  for (const ref of ['refs/heads/feature', 'refs/tags/main', 'a'.repeat(40)]) reject('arbitrary-ref:' + ref, () => {}, /Dispatch/, 'dev', { ...context('dev'), ref });
  reject('fork-repository', () => {}, /Dispatch/, 'dev', { ...context('dev'), repository: 'fork/PublishGraph.Foundation' });
  reject('extra-dispatch-input', () => {}, /Dispatch/, 'dev', { ...context('dev'), inputs: { environment: 'dev', ref: 'main' } });
  reject('nonmanual-event', () => {}, /Dispatch/, 'dev', { ...context('dev'), eventName: 'push' });
  reject('wrong-app-binding', f => { f.contract.environments.dev.target.appId += '-other'; }, /infrastructure/);
  reject('wrong-subscription-binding', f => { f.contract.environments.dev.target.subscriptionId = guid('6'); }, /infrastructure/);
  reject('wrong-rg-binding', f => { f.contract.environments.dev.target.resourceGroup = 'other'; }, /infrastructure/);
  reject('wrong-plan-binding', f => { f.contract.environments.dev.target.planId += '-other'; }, /infrastructure/);
  reject('wrong-fic-subject', f => { f.contract.environments.dev.oidc.subject += '-other'; }, /FIC/);
  reject('missing-artifact-id', f => { delete f.contract.environments.dev.artifact.id; }, /artifact provenance/);
  reject('receipt-semantic-drift', f => { f.files.set(f.contract.environments.dev.receipts.auth.path, Buffer.from('{}')); }, /acceptance mismatch/);
  reject('receipt-path-traversal', f => { f.contract.environments.dev.receipts.auth.path = '../owner.json'; }, /Unsafe/);
  reject('missing-domain-evidence', f => { delete f.contract.environments.dev.receipts.domainReadiness; }, /receipt descriptor/);
  reject('missing-capacity-evidence', f => { delete f.contract.environments.dev.receipts.capacityReadiness; }, /receipt descriptor/);
  for (const name of ['ownerPacket', 'auth', 'ownerReadiness']) reject('missing-semantic-owner-auth-control:' + name, f => { delete f.contract.environments.dev.receipts[name]; }, /receipt descriptor/);
  for (const value of [null, [], 1]) reject('control-object-required:' + JSON.stringify(value), f => { f.files.set(f.contract.environments.dev.receipts.auth.path, Buffer.from(JSON.stringify(value))); }, /JSON object/);
  for (const [field, value] of [['kind', 'other'], ['disposition', 'READY'], ['functionId', 'other'], ['gateId', 'other'], ['environment', 'prod'], ['appId', 'other'], ['sourceCommit', 'f'.repeat(40)], ['artifactSha256', 'f'.repeat(64)]])
    reject('auth-semantic:' + field, f => { f.changeReceipt('dev', 'auth', data => { data[field] = value; }); }, /acceptance mismatch/);
  for (const [field, value] of [['kind', 'other'], ['disposition', 'MISSING'], ['functionId', 'other'], ['gateId', 'other'], ['sourceCommit', 'f'.repeat(40)], ['artifactSha256', 'f'.repeat(64)]])
    reject('owner-packet-semantic:' + field, f => { f.changeReceipt('dev', 'ownerPacket', data => { data[field] = value; }); }, /acceptance mismatch/);
  reject('wrong-domain-gate', f => { const d = f.contract.environments.dev.receipts.domainReadiness; d.gateId = 'other'; f.changeReceipt('dev', 'domainReadiness', data => { data.gateId = 'other'; }); }, /DOMAIN-01/);
  reject('wrong-capacity-disposition', f => { f.changeReceipt('dev', 'capacityReadiness', data => { data.disposition = 'MISSING'; }); }, /acceptance mismatch/);
  reject('ready-boolean-is-not-proof', f => { f.changeReceipt('dev', 'auth', data => { delete data.disposition; data.ready = true; }); }, /acceptance mismatch/);
  reject('wrong-receipt-environment', f => { f.changeReceipt('dev', 'artifactAcceptance', data => { data.environment = 'prod'; }); }, /acceptance mismatch/);
  reject('wrong-receipt-payload', f => { f.changeReceipt('dev', 'artifactAcceptance', data => { data.artifactSha256 = 'f'.repeat(64); }); }, /acceptance mismatch/);
  reject('missing-host-settings', f => { f.changeReceipt('dev', 'ownerReadiness', data => { delete data.hosting; }); }, /host\/settings/);
  for (const bad of [true, 'false']) reject('literal-false-scm:' + bad, f => { f.changeReceipt('dev', 'ownerReadiness', data => { data.hosting.scmBasicPublishing = bad; }); }, /literal-false/);
  reject('prior-domain-stage-missing', f => { f.contract.environments.test.receipts.priorEnvironment.pop(); }, /stage evidence/, 'test');
  reject('different-predecessor-payload', f => { f.contract.environments.test.artifact.zipSha256 = 'e'.repeat(64); }, /different immutable/, 'prod');
  const f = fixture(), selection = resolveBinding(f.contract, 'dev', context('dev'), f.read);
  for (const [name, change] of [
    ['wrong-run-id', (url, value) => url.includes('/runs/') ? { ...value, id: value.id + 1 } : value],
    ['wrong-run-repository', (url, value) => url.includes('/runs/') ? { ...value, repository: { full_name: 'fork/other' } } : value],
    ['wrong-producer-workflow', (url, value) => url.includes('/runs/') ? { ...value, path: '.github/workflows/other.yml' } : value],
    ['wrong-run-conclusion', (url, value) => url.includes('/runs/') ? { ...value, conclusion: 'failure' } : value],
    ['wrong-run-source', (url, value) => url.includes('/runs/') ? { ...value, head_sha: 'f'.repeat(40) } : value],
    ['wrong-artifact-name', (url, value) => url.includes('/artifacts/') ? { ...value, name: 'latest' } : value],
    ['wrong-artifact-id', (url, value) => url.includes('/artifacts/') ? { ...value, id: value.id + 1 } : value],
    ['wrong-artifact-run-link', (url, value) => url.includes('/artifacts/') ? { ...value, workflow_run: { ...value.workflow_run, id: 999 } } : value],
    ['wrong-artifact-source', (url, value) => url.includes('/artifacts/') ? { ...value, workflow_run: { ...value.workflow_run, head_sha: 'f'.repeat(40) } } : value],
    ['expired-artifact', (url, value) => url.includes('/artifacts/') ? { ...value, expired: true } : value],
    ['wrong-archive-digest', (url, value) => url.includes('/artifacts/') ? { ...value, digest: 'sha256:' + 'f'.repeat(64) } : value],
    ['wrong-environment-policy', (url, value) => url.includes('/environments/') && !url.endsWith('/deployment-branch-policies') ? { ...value, deployment_branch_policy: null } : value],
    ['wrong-environment-ref', (url, value) => url.endsWith('/deployment-branch-policies') ? { ...value, branch_policies: [{ name: '*', type: 'branch' }] } : value]
  ]) {
    try { await verifyGithub(selection, apiFixture(selection, change).api); check(name, false); } catch { check(name, true); }
  }
  for (const status of [403, 404]) { try { await verifyGithub(selection, async () => { throw Error('HTTP ' + status); }); check('inaccessible-metadata:' + status, false); } catch { check('inaccessible-metadata:' + status, true); } }
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sda-release-binding-fixture-'));
  fs.writeFileSync(path.join(directory, 'website.zip'), f.zip); fs.writeFileSync(path.join(directory, 'package.json'), f.packageBytes);
  check('exact-payload-files', verifyArtifact(selection, directory).zipSha256 === selection.binding.artifact.zipSha256);
  try { verifyArtifact(selection, directory, { ...fs, lstatSync: () => ({ isFile: () => true, isSymbolicLink: () => true }) }); check('artifact-symlink-rejected', false); } catch { check('artifact-symlink-rejected', true); }
  try { verifyArtifact(selection, directory, { ...fs, readdirSync: () => ['package.json', '../website.zip'] }); check('artifact-path-traversal-rejected', false); } catch { check('artifact-path-traversal-rejected', true); }
  fs.writeFileSync(path.join(directory, 'website.zip'), 'changed');
  try { verifyArtifact(selection, directory); check('payload-byte-drift', false); } catch { check('payload-byte-drift', true); }
  fs.writeFileSync(path.join(directory, 'website.zip'), f.zip); fs.writeFileSync(path.join(directory, 'extra.json'), '{}');
  try { verifyArtifact(selection, directory); check('unlisted-artifact-file', false); } catch { check('unlisted-artifact-file', true); }
  const payloadFs = bytes => ({ ...fs, readdirSync: () => ['package.json', 'website.zip'], lstatSync: () => ({ isFile: () => true, isSymbolicLink: () => false }), readFileSync: name => name.endsWith('website.zip') ? f.zip : bytes });
  try { verifyArtifact(selection, directory, payloadFs(Buffer.from('corrupted receipt'))); check('package-receipt-byte-integrity', false); } catch { check('package-receipt-byte-integrity', true); }
  for (const field of ['sourceCommit', 'package']) {
    const data = JSON.parse(f.packageBytes); data[field] = field === 'sourceCommit' ? 'f'.repeat(40) : { sha256: 'f'.repeat(64) }; const bytes = Buffer.from(JSON.stringify(data));
    const modified = structuredClone(selection); modified.binding.artifact.packageReceiptSha256 = sha(bytes);
    try { verifyArtifact(modified, directory, payloadFs(bytes)); check('package-receipt-provenance:' + field, false); } catch { check('package-receipt-provenance:' + field, true); }
  }
  const result = { mode: 'Synthetic fixtures only; no actual Actions token permission, provider output, stage acceptance or cloud call is proven', counts: { pass: rows.filter(r => r.pass).length, fail: rows.filter(r => !r.pass).length, total: rows.length }, rows };
  const output = argument('--output'); if (!output) throw Error('--output required'); writeNew(output, result);
  console.log(JSON.stringify({ counts: result.counts, failures: rows.filter(r => !r.pass) })); if (result.counts.fail) process.exitCode = 1;
}
module.exports = { fixture, context, apiFixture };
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
