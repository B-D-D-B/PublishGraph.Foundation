'use strict';
// Focused synthetic app-only guard checks; no Azure/Graph/token or deployment calls.
const { fixture, context } = require('./check-release-binding.cjs');
const { resolveBinding } = require('./release-binding.cjs');
const { verifyTarget, validatePacket } = require('./release-target.cjs');
const { argument, writeNew, fs, path, sha } = require('./common.cjs');
const guid = digit => `${digit.repeat(8)}-${digit.repeat(4)}-${digit.repeat(4)}-${digit.repeat(4)}-${digit.repeat(12)}`;
function selection(environment = 'dev', stage = 'custom-domain') { const f = fixture(stage); return resolveBinding(f.contract, environment, context(environment), f.read); }
function runner(s, change) {
  const calls = [], b = s.binding;
  return { calls, execute: args => {
    calls.push(args); let value;
    const command = args.slice(0, 3).join(' ');
    if (args[0] === 'account' && args[1] === 'show') value = { tenant: b.oidc.tenantId, subscription: b.target.subscriptionId, user: { type: 'servicePrincipal', name: b.oidc.clientId } };
    else if (args[0] === 'webapp' && args[1] === 'show') value = { id: b.target.appId, plan: { serverFarmId: b.target.planId, appServicePlanId: b.target.planId, armServerFarmId: b.target.planId }, kind: 'app,linux', httpsOnly: true, defaultHostname: b.target.defaultHostname };
    else if (command === 'webapp config show') value = { alwaysOn: true, stack: 'DOTNETCORE|10.0', tls: '1.2', ftps: 'Disabled' };
    else if (command === 'role assignment list') {
      if (args[args.indexOf('--scope') + 1] !== b.target.appId || args[args.indexOf('--assignee') + 1] !== b.oidc.principalId) throw Error('Role request escaped fixed app/principal');
      value = [{ scope: b.target.appId, principalId: b.oidc.principalId, roleDefinitionId: '/providers/Microsoft.Authorization/roleDefinitions/' + b.oidc.roleDefinitionId }];
    } else if (args[0] === 'rest' && args[args.indexOf('--url') + 1].startsWith('https://management.azure.com' + b.target.appId + '/basicPublishingCredentialsPolicies/')) value = false;
    else throw Error('Unpermitted CLI request: ' + command);
    return change ? change(args, value) : value;
  } };
}
function packetChange(s, change) { const packet = JSON.parse(Buffer.from(s.ownerPacketBase64, 'base64')); change(packet); const bytes = Buffer.from(JSON.stringify(packet)); s.ownerPacketBase64 = bytes.toString('base64'); }
const rows = [], check = (name, pass, detail) => rows.push({ name, pass: !!pass, ...(pass ? {} : { detail }) });
for (const environment of ['dev', 'test', 'prod']) {
  const s = selection(environment), mock = runner(s);
  try { verifyTarget(s, mock.execute); check('complete-fixed-app-only-path:' + environment, mock.calls.length === 6); }
  catch (error) { check('complete-fixed-app-only-path:' + environment, false, error.message); }
}
for (const environment of ['dev', 'test', 'prod']) {
  const s = selection(environment, 'default-host'), mock = runner(s);
  try { verifyTarget(s, mock.execute); check('default-host-retains-six-app-only-guards:' + environment, mock.calls.length === 6 && !s.authReceiptBase64); }
  catch (error) { check('default-host-retains-six-app-only-guards:' + environment, false, error.message); }
}
for (const [name, mutate] of [
  ['missing-stage', s => { delete s.binding.stage; }],
  ['unknown-stage', s => { s.binding.stage = 'anything'; }],
  ['cross-stage-owner', s => packetChange(s, packet => { packet.stage = 'custom-domain'; })],
  ['wrong-client', s => { s.binding.oidc.clientId = guid('6'); }],
  ['wrong-plan-sku', s => packetChange(s, packet => { packet.plan.observedSku = 'F1'; })]
]) {
  const s = selection('dev', 'default-host'); mutate(s); const mock = runner(s);
  try { verifyTarget(s, mock.execute); check('default-host-invalid-before-provider:' + name, false); }
  catch { check('default-host-invalid-before-provider:' + name, mock.calls.length === 0); }
}
for (const bad of [true, 'false']) {
  const s = selection('dev', 'default-host'), mock = runner(s, (args, value) => args[0] === 'rest' ? bad : value);
  try { verifyTarget(s, mock.execute); check('default-host-literal-false:' + bad, false); }
  catch { check('default-host-literal-false:' + bad, true); }
}
for (const stage of ['default-host', 'custom-domain']) {
  for (const value of [undefined, 'unrelated-host.azurewebsites.net']) {
    const s = selection('dev', stage); packetChange(s, packet => { packet.defaultHostname = value; }); const mock = runner(s);
    try { verifyTarget(s, mock.execute); check('F01-owner-host-before-provider:' + stage + ':' + value, false); }
    catch { check('F01-owner-host-before-provider:' + stage + ':' + value, mock.calls.length === 0); }
    const actual = selection('dev', stage), actualMock = runner(actual, (args, data) => args[0] === 'webapp' && args[1] === 'show' ? { ...data, defaultHostname: value } : data);
    try { verifyTarget(actual, actualMock.execute); check('F01-actual-host-mismatch:' + stage + ':' + value, false); }
    catch (error) { check('F01-actual-host-mismatch:' + stage + ':' + value, /actual app\/default hostname/.test(error.message) && actualMock.calls.length === 3); }
  }
  const s = selection('dev', stage), mock = runner(s); verifyTarget(s, mock.execute);
  check('F01-host-read-in-existing-app-query:' + stage, mock.calls.length === 6 && mock.calls.find(args => args[0] === 'webapp' && args[1] === 'show').includes('{id:id,plan:{serverFarmId:serverFarmId,appServicePlanId:appServicePlanId,armServerFarmId:properties.serverFarmId},kind:kind,httpsOnly:httpsOnly,defaultHostname:defaultHostName}'));
}
const formatting = selection();
formatting.ownerPacketBase64 = Buffer.from(JSON.stringify(JSON.parse(Buffer.from(formatting.ownerPacketBase64, 'base64')), null, 4) + '\n').toString('base64');
formatting.authReceiptBase64 = Buffer.from(JSON.stringify(JSON.parse(Buffer.from(formatting.authReceiptBase64, 'base64')), null, 4) + '\n').toString('base64');
try { const mock = runner(formatting); verifyTarget(formatting, mock.execute); check('benign-control-formatting-no-pin', mock.calls.length === 6); }
catch (error) { check('benign-control-formatting-no-pin', false, error.message); }
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
reject('actual-app-plan-mismatch', () => {}, (args, value) => args[0] === 'webapp' && args[1] === 'show' ? { ...value, plan: { ...value.plan, serverFarmId: value.plan.serverFarmId + '-other' } } : value, /actual app/);
reject('owner-current-f1-is-not-required-b2', s => packetChange(s, packet => { packet.plan.observedSku = 'F1'; }), null, /required actual Linux/, true);
for (const [field, value] of [['sourceCommit', 'f'.repeat(40)], ['artifactSha256', 'f'.repeat(64)], ['kind', 'other'], ['gateId', 'other'], ['disposition', 'MISSING']])
  reject('owner-packet-semantic:' + field, s => packetChange(s, packet => { packet[field] = value; }), null, /semantic scope/, true);
for (const [field, value] of [['id', 'other'], ['requiredSku', 'F1'], ['linux', false], ['region', 'westus2'], ['capacity', 2], ['verifiedAtUtc', 'not-a-time']])
  reject('owner-plan-observation:' + field, s => packetChange(s, packet => { packet.plan[field] = value; }), null, /required actual Linux/, true);
reject('missing-owner-plan-time', s => packetChange(s, packet => { delete packet.plan.verifiedAtUtc; }), null, /required actual Linux/, true);
reject('missing-owner-identity-principal', s => packetChange(s, packet => { delete packet.identity.principalId; }), null, /mapping mismatch/, true);
reject('wrong-fic-subject', s => packetChange(s, packet => { packet.identity.subject += '-other'; }), null, /federated subject/, true);
reject('auth-receipt-semantic-drift', s => { s.authReceiptBase64 = Buffer.from('{}').toString('base64'); }, null, /auth receipt scope/, true);
for (const bad of [true, 'false']) reject('basic-publishing-not-literal-false:' + bad, () => {}, (args, value) => args[0] === 'rest' ? bad : value, /Basic publishing/);

// BINDING-02: the observed null CLI alias must not conceal a conflicting alias.
const aliases = ['serverFarmId', 'appServicePlanId', 'armServerFarmId'];
const associationRows = [
  ['all-matching', id => Object.fromEntries(aliases.map(key => [key, id]))],
  ['case-insensitive', id => ({ serverFarmId: id.toUpperCase(), appServicePlanId: id, armServerFarmId: id.toLowerCase() })],
  ['observed-null-root', id => ({ serverFarmId: null, appServicePlanId: id, armServerFarmId: id })]
];
for (const alias of aliases) {
  associationRows.push(['sole-missing-others:' + alias, id => ({ [alias]: id })]);
  associationRows.push(['sole-null-others:' + alias, id => ({ ...Object.fromEntries(aliases.map(key => [key, null])), [alias]: id })]);
}
for (const [name, project] of associationRows) {
  const s = selection(), mock = runner(s, (args, value) => args[0] === 'webapp' && args[1] === 'show' ? { ...value, plan: project(s.binding.target.planId) } : value);
  try { verifyTarget(s, mock.execute); check('B02-association-positive:' + name, mock.calls.length === 6); }
  catch (error) { check('B02-association-positive:' + name, false, error.message); }
}
const invalidAssociations = [['all-missing', {}], ['all-null', Object.fromEntries(aliases.map(key => [key, null]))],
  ['missing-container', undefined], ['null-container', null], ['array-container', []], ['string-container', 'invalid'], ['number-container', 1]];
for (const alias of aliases) {
  for (const value of ['', ' ', 1, false, [], {}, 'wrong-fixed-plan']) {
    invalidAssociations.push([alias + ':' + JSON.stringify(value), { ...Object.fromEntries(aliases.map(key => [key, selection().binding.target.planId])), [alias]: value }]);
  }
  invalidAssociations.push(['sole-wrong-plan:' + alias, { [alias]: 'wrong-fixed-plan' }]);
}
for (const [name, plan] of invalidAssociations)
  reject('B02-association-negative:' + name, () => {}, (args, value) => args[0] === 'webapp' && args[1] === 'show' ? { ...value, plan } : value, /actual app/);
for (const [environment, requiredSku] of [['dev', 'B2'], ['test', 'B1'], ['prod', 'B3']]) {
  const s = selection(environment); check('B02-required-sku:' + environment, validatePacket(s).plan.requiredSku === requiredSku);
  for (const field of ['observedSku', 'requiredSku']) for (const bad of ['F1', environment === 'dev' ? 'B1' : 'B2']) {
    const badSelection = selection(environment); packetChange(badSelection, packet => { packet.plan[field] = bad; }); const mock = runner(badSelection);
    try { verifyTarget(badSelection, mock.execute); check('B02-reject-sku:' + environment + ':' + field + ':' + bad, false); }
    catch (error) { check('B02-reject-sku:' + environment + ':' + field + ':' + bad, /required actual Linux/.test(error.message) && mock.calls.length === 0); }
  }
}
const drift = selection(); drift.ownerPacketBase64 = Buffer.from('{}').toString('base64');
try { validatePacket(drift); check('owner-packet-semantic-drift', false); } catch (error) { check('owner-packet-semantic-drift', /Owner packet semantic/.test(error.message)); }
const source = fs.readFileSync(path.join(__dirname, 'release-target.cjs'));
check('no-shared-plan-or-directory-cli', !/appservice['"]|['"]ad['"]|get-access-token/.test(source.toString()));
check('no-approval-boolean-switch', !source.toString().includes('SDA_AUTH_READY'));
check('no-control-hash-environment-or-marker-gates', !/SDA_HOSTING_PACKET_SHA256|SDA_AUTH_DISPOSITION_SHA256|authDispositionSha256|mappingEvidenceSha256|verificationEvidenceSha256|createHash/.test(source.toString()));
const result = { mode: 'Synthetic fixed selections and in-memory app-only responses; zero cloud calls', guardSha256: sha(source), counts: { pass: rows.filter(r => r.pass).length, fail: rows.filter(r => !r.pass).length, total: rows.length }, rows };
const output = argument('--output'); if (!output) throw Error('--output required'); writeNew(output, result);
console.log(JSON.stringify({ counts: result.counts, failures: rows.filter(row => !row.pass) })); if (result.counts.fail) process.exitCode = 1;
