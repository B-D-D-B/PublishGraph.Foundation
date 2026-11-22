'use strict';
const cp = require('node:child_process');
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
function targetEnvironment(selection) {
  const b = selection.binding;
  return { SDA_ENVIRONMENT: selection.environment, AZURE_CLIENT_ID: b.oidc.clientId, AZURE_TENANT_ID: b.oidc.tenantId,
    AZURE_SUBSCRIPTION_ID: b.target.subscriptionId, SDA_APP_NAME: b.target.appName, SDA_RESOURCE_GROUP: b.target.resourceGroup,
    SDA_APP_ID: b.target.appId, SDA_PLAN_ID: b.target.planId, SDA_PRINCIPAL_ID: b.oidc.principalId,
    SDA_DEPLOY_ROLE_ID: b.oidc.roleDefinitionId, SDA_HOSTING_PACKET_BASE64: selection.ownerPacketBase64 };
}
function validatePacket(selection) {
  const env = targetEnvironment(selection);
  const required = ['SDA_ENVIRONMENT', 'AZURE_CLIENT_ID', 'AZURE_TENANT_ID', 'AZURE_SUBSCRIPTION_ID', 'SDA_APP_NAME', 'SDA_RESOURCE_GROUP', 'SDA_APP_ID', 'SDA_PLAN_ID', 'SDA_PRINCIPAL_ID', 'SDA_DEPLOY_ROLE_ID', 'SDA_HOSTING_PACKET_BASE64'];
  for (const key of required) if (!env[key]) throw Error('Required reviewed environment variable missing: ' + key);
  if (!['dev', 'test', 'prod'].includes(env.SDA_ENVIRONMENT)) throw Error('Unknown environment');
  const authBytes = Buffer.from(selection.authReceiptBase64 || '', 'base64');
  const auth = JSON.parse(authBytes), descriptor = selection.binding.receipts.auth;
  if (auth.kind !== 'auth-disposition' || auth.disposition !== 'PASS' || auth.environment !== env.SDA_ENVIRONMENT
      || auth.gateId !== descriptor.gateId || auth.functionId !== descriptor.functionId || !equal(auth.appId, env.SDA_APP_ID)
      || auth.artifactSha256 !== selection.binding.artifact.zipSha256 || auth.sourceCommit !== selection.binding.artifact.sourceCommit)
    throw Error('Accepted auth receipt scope/disposition mismatch');
  const bytes = Buffer.from(env.SDA_HOSTING_PACKET_BASE64, 'base64');
  const packet = JSON.parse(bytes);
  const expectedId = `/subscriptions/${env.AZURE_SUBSCRIPTION_ID}/resourceGroups/${env.SDA_RESOURCE_GROUP}/providers/Microsoft.Web/sites/${env.SDA_APP_NAME}`;
  const ownerDescriptor = selection.binding.receipts.ownerPacket;
  if (packet.version !== 1 || packet.kind !== 'owner-hosting-packet' || !['READY', 'PASS'].includes(packet.disposition)
      || packet.disposition !== ownerDescriptor.disposition || typeof ownerDescriptor.functionId !== 'string' || !ownerDescriptor.functionId
      || typeof ownerDescriptor.gateId !== 'string' || !ownerDescriptor.gateId
      || packet.functionId !== ownerDescriptor.functionId || packet.gateId !== ownerDescriptor.gateId
      || packet.environment !== env.SDA_ENVIRONMENT || !equal(expectedId, env.SDA_APP_ID)
      || !equal(packet.appId, expectedId) || !equal(packet.subscriptionId, env.AZURE_SUBSCRIPTION_ID)
      || packet.sourceCommit !== selection.binding.artifact.sourceCommit || packet.artifactSha256 !== selection.binding.artifact.zipSha256)
    throw Error('Owner packet semantic scope/disposition/app/environment mismatch');
  const identity = packet.identity;
  if (!identity || !equal(identity.tenantId, env.AZURE_TENANT_ID) || !equal(identity.clientId, env.AZURE_CLIENT_ID)
      || !equal(identity.principalId, env.SDA_PRINCIPAL_ID) || !equal(identity.roleDefinitionId, env.SDA_DEPLOY_ROLE_ID)
      || !equal(identity.roleScope, expectedId)) throw Error('Owner packet client/principal/role mapping mismatch');
  const subject = `repo:B-D-D-B/PublishGraph.Foundation:environment:${selection.githubEnvironment}`;
  if (selection.repository !== 'B-D-D-B/PublishGraph.Foundation' || selection.binding.oidc.subject !== subject
      || identity.issuer !== 'https://token.actions.githubusercontent.com' || identity.audience !== 'api://AzureADTokenExchange'
      || identity.subject !== subject) throw Error('Owner packet federated subject mismatch');
  const plan = packet.plan, requiredSku = env.SDA_ENVIRONMENT === 'prod' ? 'B3' : 'B1';
  if (!plan || !equal(plan.id, env.SDA_PLAN_ID) || !plan.id.toLowerCase().startsWith(`/subscriptions/${env.AZURE_SUBSCRIPTION_ID}/`.toLowerCase())
      || plan.observedSku !== requiredSku || plan.requiredSku !== requiredSku || plan.linux !== true
      || plan.region !== 'westus3' || plan.capacity !== 1
      || !Number.isFinite(Date.parse(plan.verifiedAtUtc))) throw Error('Owner packet does not prove the required actual Linux B1/B1/B3 plan');
  return packet;
}
function executeAz(args, env) {
  return JSON.parse(cp.execFileSync('az', [...args, '--subscription', env.AZURE_SUBSCRIPTION_ID, '--output', 'json', '--only-show-errors'], { encoding: 'utf8', maxBuffer: 1024 * 1024 }));
}
function verifyTarget(selection, execute = executeAz) {
  const env = targetEnvironment(selection), packet = validatePacket(selection), az = args => execute(args, env);
  const account = az(['account', 'show', '--query', '{tenant:tenantId,subscription:id,user:user}']);
  if (!equal(account.tenant, packet.identity.tenantId) || !equal(account.subscription, packet.subscriptionId)
      || account.user.type !== 'servicePrincipal' || !equal(account.user.name, packet.identity.clientId)) throw Error('Authenticated OIDC client does not match accepted owner identity');
  const scope = ['--resource-group', env.SDA_RESOURCE_GROUP, '--name', env.SDA_APP_NAME];
  const app = az(['webapp', 'show', ...scope, '--query', '{id:id,plan:serverFarmId,kind:kind,httpsOnly:httpsOnly}']);
  const config = az(['webapp', 'config', 'show', ...scope, '--query', '{alwaysOn:alwaysOn,stack:linuxFxVersion,tls:minTlsVersion,ftps:ftpsState}']);
  // App association is observable with app-only RBAC. The shared plan's actual SKU
  // comes from independently accepted owner evidence; this identity never reads it.
  if (!equal(app.id, packet.appId) || !equal(app.plan, packet.plan.id) || !app.kind.includes('linux') || app.kind.includes('functionapp') || !app.httpsOnly) throw Error('Hosting packet does not match actual app');
  if (!config.alwaysOn || config.stack !== 'DOTNETCORE|10.0' || !['1.2', '1.3'].includes(config.tls) || config.ftps !== 'Disabled') throw Error('Runtime/Always On/TLS/FTPS mismatch');
  const roles = az(['role', 'assignment', 'list', '--assignee', packet.identity.principalId, '--scope', packet.appId, '--include-inherited', '--fill-principal-name', 'false']);
  if (!roles.length || roles.some(role => !equal(role.principalId, packet.identity.principalId) || !equal(role.scope, packet.appId))
      || !roles.some(role => equal(role.roleDefinitionId.split('/').pop(), packet.identity.roleDefinitionId))) throw Error('Bound deployment principal is not confined to the reviewed app role');
  for (const policy of ['ftp', 'scm']) {
    const actual = az(['rest', '--method', 'get', '--url', `https://management.azure.com${packet.appId}/basicPublishingCredentialsPolicies/${policy}?api-version=2024-11-01`, '--query', 'properties.allow']);
    if (actual !== false) throw Error('Basic publishing is enabled: ' + policy);
  }
  return { appId: packet.appId, planId: packet.plan.id, ownerObservedSku: packet.plan.observedSku, principalId: packet.identity.principalId };
}
module.exports = { validatePacket, verifyTarget };
if (require.main === module) {
  const argument = name => process.argv[process.argv.indexOf(name) + 1];
  const { loadSelection, verifyArtifact } = require('./release-binding.cjs');
  const selection = loadSelection(argument('--environment'));
  if (process.argv.includes('--verify')) {
    verifyArtifact(selection, argument('--directory'));
    verifyTarget(selection);
    console.log('Exact fixed app-only guards and owner identity/plan/auth evidence passed.');
  } else if (process.argv.includes('--preflight')) validatePacket(selection);
  else throw Error('--preflight or --verify required');
}
