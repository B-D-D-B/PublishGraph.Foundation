'use strict';
// Focused synthetic app-only guard checks; no Azure/Graph/token or deployment calls.
const { fixture, context } = require('./check-release-binding.cjs');
const { resolveBinding } = require('./release-binding.cjs');
const { verifyTarget, validatePacket } = require('./release-target.cjs');
const { argument, writeNew, fs, path, sha } = require('./common.cjs');
const guid = digit => `${digit.repeat(8)}-${digit.repeat(4)}-${digit.repeat(4)}-${digit.repeat(4)}-${digit.repeat(12)}`;
function selection(environment = 'dev') { const f = fixture(); return resolveBinding(f.contract, environment, context(environment), f.read); }
function runner(s, change) {
  const calls = [], b = s.binding;
  return { calls, execute: args => {
    calls.push(args); let value;
    const command = args.slice(0, 3).join(' ');
    if (args[0] === 'account' && args[1] === 'show') value = { tenant: b.oidc.tenantId, subscription: b.target.subscriptionId, user: { type: 'servicePrincipal', name: b.oidc.clientId } };
    else if (args[0] === 'webapp' && args[1] === 'show') value = { id: b.target.appId, plan: b.target.planId, kind: 'app,linux', httpsOnly: true };
    else if (command === 'webapp config show') value = { alwaysOn: true, stack: 'DOTNETCORE|10.0', tls: '1.2', ftps: 'Disabled' };
    else if (command === 'role assignment list') {
      if (args[args.indexOf('--scope') + 1] !== b.target.appId || args[args.indexOf('--assignee') + 1] !== b.oidc.principalId) throw Error('Role request escaped fixed app/principal');
      value = [{ scope: b.target.appId, principalId: b.oidc.principalId, roleDefinitionId: '/providers/Microsoft.Authorization/roleDefinitions/' + b.oidc.roleDefinitionId }];
    } else if (args[0] === 'rest' && args[args.indexOf('--url') + 1].startsWith('https://management.azure.com' + b.target.appId + '/basicPublishingCredentialsPolicies/')) value = false;
    else throw Error('Unpermitted CLI request: ' + command);
    return change ? change(args, value) : value;
  } };
}
function packetChange(s, change) { const packet = JSON.parse(Buffer.from(s.ownerPacketBase64, 'base64')); change(packet); const bytes = Buffer.from(JSON.stringify(packet)); s.ownerPacketBase64 = bytes.toString('base64'); s.binding.receipts.ownerPacket.sha256 = sha(bytes); }
const rows = [], check = (name, pass, detail) => rows.push({ name, pass: !!pass, ...(pass ? {} : { detail }) });
for (const environment of ['dev', 'test', 'prod']) {
  const s = selection(environment), mock = runner(s);
  try { verifyTarget(s, mock.execute); check('complete-fixed-app-only-path:' + environment, mock.calls.length === 6); }
  catch (error) { check('complete-fixed-app-only-path:' + environment, false, error.message); }
}
function reject(name, changeSelection, changeResponse, expected, beforeAzure = false) {
  const s = selection(); changeSelection(s); const mock = runner(s, changeResponse);
  try { verifyTarget(s, mock.execute); check(name, false, 'Invalid selection accepted'); }
  catch (error) { check(name, expected.test(error.message) && (!beforeAzure || mock.calls.length === 0), { error: error.message, calls: mock.calls }); }
}
reject('mismatched-client-fails-before-azure', s => { s.binding.oidc.clientId = guid('6'); }, null, /mapping mismatch/, true);
reject('unrelated-narrow-principal-fails-before-azure', s => { s.binding.oidc.principalId = guid('6'); }, null, /mapping mismatch/, true);
reject('authenticated-client-mismatch', () => {}, (args, value) => args[0] === 'account' ? { ...value, user: { type: 'servicePrincipal', name: guid('6') } } : value, /Authenticated OIDC client/);
reject('observed-role-principal-mismatch', () => {}, (args, value) => args[0] === 'role' ? value.map(role => ({ ...role, principalId: guid('6') })) : value, /Bound deployment principal/);
reject('inherited-broad-role-rejected', () => {}, (args, value) => args[0] === 'role' ? value.map(role => ({ ...role, scope: '/subscriptions/' + guid('1') })) : value, /Bound deployment principal/);
reject('actual-app-plan-mismatch', () => {}, (args, value) => args[0] === 'webapp' && args[1] === 'show' ? { ...value, plan: value.plan + '-other' } : value, /actual app/);
reject('owner-current-f1-is-not-required-b1', s => packetChange(s, packet => { packet.plan.observedSku = 'F1'; }), null, /required actual Linux/, true);
reject('missing-owner-plan-evidence', s => packetChange(s, packet => { delete packet.plan.verificationEvidenceSha256; }), null, /required actual Linux/, true);
reject('missing-owner-identity-evidence', s => packetChange(s, packet => { delete packet.identity.mappingEvidenceSha256; }), null, /mapping mismatch/, true);
reject('wrong-fic-subject', s => packetChange(s, packet => { packet.identity.subject += '-other'; }), null, /federated subject/, true);
reject('auth-receipt-drift', s => { s.authReceiptBase64 = Buffer.from('{}').toString('base64'); }, null, /auth receipt byte mismatch/, true);
for (const bad of [true, 'false']) reject('basic-publishing-not-literal-false:' + bad, () => {}, (args, value) => args[0] === 'rest' ? bad : value, /Basic publishing/);
const drift = selection(); drift.ownerPacketBase64 = Buffer.from('{}').toString('base64');
try { validatePacket(drift); check('owner-packet-byte-drift', false); } catch (error) { check('owner-packet-byte-drift', /bytes do not match/.test(error.message)); }
const source = fs.readFileSync(path.join(__dirname, 'release-target.cjs'));
check('no-shared-plan-or-directory-cli', !/appservice['"]|['"]ad['"]|get-access-token/.test(source.toString()));
check('no-approval-boolean-switch', !source.toString().includes('SDA_AUTH_READY'));
const result = { mode: 'Synthetic fixed selections and in-memory app-only responses; zero cloud calls', guardSha256: sha(source), counts: { pass: rows.filter(r => r.pass).length, fail: rows.filter(r => !r.pass).length, total: rows.length }, rows };
const output = argument('--output'); if (!output) throw Error('--output required'); writeNew(output, result);
console.log(JSON.stringify({ counts: result.counts, failures: rows.filter(row => !row.pass) })); if (result.counts.fail) process.exitCode = 1;