'use strict';
// Synthetic in-memory ARM responses only. No CLI, token, Graph or cloud call is made.
const crypto = require('node:crypto');
const { verifyTarget, validatePacket } = require('./release-target.cjs');
const { argument, writeNew, fs, path, sha } = require('./common.cjs');
const guid = digit => `${digit.repeat(8)}-${digit.repeat(4)}-${digit.repeat(4)}-${digit.repeat(4)}-${digit.repeat(12)}`;
function fixture(environment = 'dev') {
  const subscription = guid('1'), client = guid('2'), principal = guid('3'), tenant = guid('4'), role = guid('5');
  const app = `/subscriptions/${subscription}/resourceGroups/sda-${environment}/providers/Microsoft.Web/sites/sda-website-web-${environment}`;
  const plan = `/subscriptions/${subscription}/resourceGroups/sda-${environment}/providers/Microsoft.Web/serverfarms/ASP-sda-${environment}-fusion`;
  const packet = { version: 1, environment, subscriptionId: subscription, appId: app, authDispositionSha256: 'a'.repeat(64), identity: { tenantId: tenant, clientId: client, principalId: principal, roleDefinitionId: role, roleScope: app, mappingEvidenceSha256: 'b'.repeat(64), issuer: 'https://token.actions.githubusercontent.com', audience: 'api://AzureADTokenExchange', subject: `repo:B-D-D-B/PublishGraph.Foundation:environment:sda-website-${environment}` }, plan: { id: plan, observedSku: environment === 'prod' ? 'B3' : 'B1', requiredSku: environment === 'prod' ? 'B3' : 'B1', linux: true, capacity: 1, region: 'westus3', verificationEvidenceSha256: 'c'.repeat(64), verifiedAtUtc: '2026-11-22T00:00:00Z' } };
  const env = { SDA_ENVIRONMENT: environment, AZURE_CLIENT_ID: client, AZURE_TENANT_ID: tenant, AZURE_SUBSCRIPTION_ID: subscription, SDA_APP_NAME: `sda-website-web-${environment}`, SDA_RESOURCE_GROUP: `sda-${environment}`, SDA_APP_ID: app, SDA_PLAN_ID: plan, SDA_PRINCIPAL_ID: principal, SDA_DEPLOY_ROLE_ID: role, SDA_AUTH_DISPOSITION_SHA256: packet.authDispositionSha256, SDA_AUTH_READY: 'true' };
  return { packet, env };
}
function seal(f) { const bytes = Buffer.from(JSON.stringify(f.packet)); f.env.SDA_HOSTING_PACKET_BASE64 = bytes.toString('base64'); f.env.SDA_HOSTING_PACKET_SHA256 = crypto.createHash('sha256').update(bytes).digest('hex'); return f; }
function runner(f, change) {
  const calls = [];
  const execute = args => {
    calls.push(args);
    let value;
    const command = args.slice(0, 3).join(' ');
    if (args[0] === 'account' && args[1] === 'show') value = { tenant: f.packet.identity.tenantId, subscription: f.packet.subscriptionId, user: { type: 'servicePrincipal', name: f.packet.identity.clientId } };
    else if (args[0] === 'webapp' && args[1] === 'show') value = { id: f.packet.appId, plan: f.packet.plan.id, kind: 'app,linux', httpsOnly: true };
    else if (command === 'webapp config show') value = { alwaysOn: true, stack: 'DOTNETCORE|10.0', tls: '1.2', ftps: 'Disabled' };
    else if (command === 'role assignment list') {
      if (args[args.indexOf('--scope') + 1] !== f.packet.appId || args[args.indexOf('--assignee') + 1] !== f.packet.identity.principalId) throw Error('Role query escaped accepted app/principal');
      value = [{ scope: f.packet.appId, principalId: f.packet.identity.principalId, roleDefinitionId: '/providers/Microsoft.Authorization/roleDefinitions/' + f.packet.identity.roleDefinitionId }];
    } else if (args[0] === 'rest' && args.includes('--url') && args[args.indexOf('--url') + 1].startsWith('https://management.azure.com' + f.packet.appId + '/basicPublishingCredentialsPolicies/')) value = false;
    else throw Error('Unpermitted CLI request: ' + command);
    return change ? change(args, value) : value;
  };
  return { calls, execute };
}
const rows = [], check = (name, pass, detail) => rows.push({ name, pass: !!pass, ...(pass ? {} : { detail }) });
for (const environment of ['dev', 'test', 'prod']) {
  const f = seal(fixture(environment)), mock = runner(f);
  try { const result = verifyTarget(f.env, mock.execute); check('complete-app-only-path:' + environment, result.principalId === f.packet.identity.principalId && mock.calls.length === 6, mock.calls); }
  catch (error) { check('complete-app-only-path:' + environment, false, error.message); }
}
function reject(name, changeFixture, changeResponse, expected, beforeAzure = false) {
  const f = fixture(); changeFixture(f); seal(f);
  const mock = runner(f, changeResponse);
  try { verifyTarget(f.env, mock.execute); check(name, false, 'Guard accepted invalid release'); }
  catch (error) { check(name, expected.test(error.message) && (!beforeAzure || mock.calls.length === 0), { error: error.message, calls: mock.calls }); }
}
reject('mismatched-client-fails-before-azure', f => { f.env.AZURE_CLIENT_ID = guid('6'); }, null, /mapping mismatch/, true);
reject('unrelated-narrow-principal-fails-before-azure', f => { f.env.SDA_PRINCIPAL_ID = guid('6'); }, null, /mapping mismatch/, true);
reject('authenticated-client-not-accepted-owner-client', () => {}, (args, value) => args[0] === 'account' ? { ...value, user: { type: 'servicePrincipal', name: guid('6') } } : value, /Authenticated OIDC client/);
reject('observed-role-principal-mismatch', () => {}, (args, value) => args[0] === 'role' ? value.map(role => ({ ...role, principalId: guid('6') })) : value, /Bound deployment principal/);
reject('inherited-broad-role-rejected', () => {}, (args, value) => args[0] === 'role' ? value.map(role => ({ ...role, scope: '/subscriptions/' + guid('1') })) : value, /Bound deployment principal/);
reject('actual-app-plan-mismatch', () => {}, (args, value) => args[0] === 'webapp' && args[1] === 'show' ? { ...value, plan: value.plan + '-other' } : value, /actual app/);
reject('owner-observed-f1-does-not-prove-required-b1', f => { f.packet.plan.observedSku = 'F1'; }, null, /required actual Linux/, true);
reject('missing-owner-plan-evidence-rejected', f => { delete f.packet.plan.verificationEvidenceSha256; }, null, /required actual Linux/, true);
reject('missing-owner-identity-evidence-rejected', f => { delete f.packet.identity.mappingEvidenceSha256; }, null, /mapping mismatch/, true);
reject('wrong-federated-environment-rejected', f => { f.packet.identity.subject = 'repo:B-D-D-B/PublishGraph.Foundation:environment:sda-dev'; }, null, /federated subject/, true);
reject('auth-disposition-mismatch-rejected', f => { f.env.SDA_AUTH_DISPOSITION_SHA256 = 'd'.repeat(64); }, null, /auth disposition mismatch/, true);
reject('basic-publishing-enabled-rejected', () => {}, (args, value) => args[0] === 'rest' ? true : value, /Basic publishing/);
const drift = seal(fixture()); drift.env.SDA_HOSTING_PACKET_BASE64 = Buffer.from(JSON.stringify({ ...drift.packet, environment: 'prod' })).toString('base64');
try { validatePacket(drift.env); check('packet-byte-drift-rejected', false); } catch (error) { check('packet-byte-drift-rejected', /bytes do not match/.test(error.message)); }
const source = fs.readFileSync(path.join(__dirname, 'release-target.cjs'));
check('no-shared-plan-or-directory-cli-path', !/appservice['"]|['"]ad['"]|get-access-token/.test(source.toString()));
const result = { mode: 'synthetic fixtures and in-memory mocked app-only CLI; zero cloud calls', guardSha256: sha(source), counts: { pass: rows.filter(r => r.pass).length, fail: rows.filter(r => !r.pass).length, total: rows.length }, rows };
const output = argument('--output'); if (!output) throw Error('--output required'); writeNew(output, result);
console.log(JSON.stringify({ counts: result.counts, failures: rows.filter(row => !row.pass) })); if (result.counts.fail) process.exitCode = 1;
