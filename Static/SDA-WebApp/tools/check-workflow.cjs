'use strict';
const vm = require('node:vm');
const { fs, path, project, sha, argument, writeNew } = require('./common.cjs');
const workflow = path.resolve(project, '../../.github/workflows/deploy-sda-website.yml');
const source = fs.readFileSync(workflow, 'utf8'), rows = [];
const check = (name, pass, detail) => rows.push({ name, pass: !!pass, ...(pass ? {} : { detail }) });
const dispatch = source.slice(source.indexOf('  workflow_dispatch:'), source.indexOf('\npermissions:'));
const inputKeys = [...dispatch.matchAll(/^ {6}([a-zA-Z_][\w-]*):$/gm)].map(match => match[1]);
check('exact-environment-only-input', JSON.stringify(inputKeys) === JSON.stringify(['environment']) && /type: choice/.test(dispatch) && /options: \[dev, test, prod\]/.test(dispatch));
check('manual-only', /\non:\n  workflow_dispatch:/.test(source) && !/\n  (push|pull_request|schedule|workflow_run):/.test(source));
const workflowFiles = fs.readdirSync(path.dirname(workflow)).filter(name => /\.ya?ml$/.test(name));
const websiteManual = workflowFiles.filter(name => { const bytes = fs.readFileSync(path.join(path.dirname(workflow), name), 'utf8'); return /workflow_dispatch/.test(bytes) && /sda-website|Deploy SDA website/.test(bytes); });
check('one-website-manual-workflow', websiteManual.length === 1 && websiteManual[0] === path.basename(workflow));
check('no-mutable-target-or-approval-variables', !/vars\.|secrets\.|SDA_AUTH_READY|publish-profile|deployment_token|AZURE_STATIC_WEB_APPS/i.test(source));
check('no-deployment-rebuild-or-artifact-upload', !/dotnet (?:build|publish)|setup-dotnet|package\.cjs|upload-artifact|npm (?:ci|install)/.test(source));
check('per-environment-serialization', /group: sda-website-\$\{\{ inputs.environment \}\}/.test(source) && /cancel-in-progress: false/.test(source));
const resolver = source.slice(source.indexOf('  resolve:'), source.indexOf('  deploy:'));
check('resolver-before-named-environment-and-oidc', !/\n    environment:|id-token:/.test(resolver) && /needs: resolve/.test(source) && /environment: \$\{\{ needs.resolve.outputs.github_environment \}\}/.test(source));
check('minimal-job-permissions', /contents: read/.test(resolver) && /actions: read/.test(resolver) && (source.match(/id-token: write/g) || []).length === 1 && !/(contents|actions|deployments): write/.test(source));
check('exact-immutable-artifact-selector', /artifact-ids: \$\{\{ needs.resolve.outputs.artifact_id \}\}/.test(source) && /run-id: \$\{\{ needs.resolve.outputs.artifact_run_id \}\}/.test(source) && !/\blatest\b/.test(source));
check('ref-refusal-before-checkout', source.indexOf('process.env.GITHUB_REF') < source.indexOf('uses: actions/checkout@') && /ref: \$\{\{ github.sha \}\}/.test(source));
check('fixed-receipts-payload-before-azure-login', source.indexOf('--verify-artifact') < source.indexOf('uses: azure/login@') && source.indexOf('--resolve') < source.indexOf('  deploy:'));
check('fixed-resolver-oidc-outputs-only', ['client_id', 'tenant_id', 'subscription_id'].every(key => source.includes('needs.resolve.outputs.' + key)));
check('rehash-immediately-before-actions-deployment', source.lastIndexOf('--verify-artifact') > source.indexOf('release-target.cjs --verify') && source.lastIndexOf('--verify-artifact') < source.indexOf('az webapp deploy') && /--src-path release\/accepted\/website.zip/.test(source));
const uses = [...source.matchAll(/uses: ([^\s]+)@([^\s]+)/g)];
check('actions-commit-pinned', uses.length === 4 && uses.every(match => /^[a-f0-9]{40}$/.test(match[2])));
const contract = JSON.parse(fs.readFileSync(path.resolve(project, '../../.github/sda-website-release-bindings.json')));
check('real-bindings-null-inactive', Object.keys(contract.environments).length === 3 && Object.values(contract.environments).every(value => value === null));
check('fixed-main-service-contract', contract.allowedWorkflowRef === 'refs/heads/main' && contract.repository === 'B-D-D-B/PublishGraph.Foundation' && contract.workflowPath === '.github/workflows/deploy-sda-website.yml');
const successor = JSON.parse(fs.readFileSync(path.join(__dirname, 'deploy-contract.json')));
check('successor-semantic-control-descriptor-no-pin', successor.version === 1 && successor.status === 'inactive'
  && JSON.stringify(successor.controlDescriptor.required) === JSON.stringify(['path', 'functionId', 'gateId', 'disposition']));
check('successor-automatic-artifact-integrity-retained', successor.automaticIntegrity.preserved === true
  && ['runId', 'id', 'name', 'sourceCommit', 'producerWorkflowPath', 'archiveSha256', 'zipSha256', 'packageReceiptSha256'].every(key => successor.automaticIntegrity.artifactDescriptorFields.includes(key)));
check('successor-owner-scope-kind-and-literal-false', successor.receipts.ownerPacket.kind === 'owner-hosting-packet'
  && successor.controlDescriptor.commonSemanticFields.includes('sourceCommit') && successor.controlDescriptor.commonSemanticFields.includes('artifactSha256')
  && JSON.stringify(successor.targetGuards.literalFalsePublishing) === JSON.stringify(['ftp', 'scm']));
check('historical-contract-hold-retained', successor.publication.held === true && successor.publication.forbidden.includes('push') && successor.publication.forbidden.includes('binding activation'));
const staging = JSON.parse(fs.readFileSync(path.join(__dirname, 'staging-contract.json')));
check('fixed-two-stages-no-extra-input', JSON.stringify(staging.stages) === JSON.stringify(['default-host', 'custom-domain']) && staging.stageField === 'binding.stage' && inputKeys.length === 1);
check('default-functional-gaps-scoped', staging.defaultHost.authDispositionPassRequired === false && staging.defaultHost.vanityDomain01Required === false
  && JSON.stringify(staging.defaultHost.predecessorStages) === JSON.stringify(['default-host']));
check('custom-full-functional-controls-retained', staging.customDomain.authDispositionPassRequired === true && staging.customDomain.vanityDomain01Required === true
  && JSON.stringify(staging.customDomain.predecessorStages) === JSON.stringify(['default-host', 'custom-domain']));
check('four-stage-scoped-owner-artifact-cap-controls', JSON.stringify(staging.stageScopedControls) === JSON.stringify(['ownerPacket', 'ownerReadiness', 'artifactAcceptance', 'capacityReadiness']));
check('owner-selected-actual-default-host-tuple', /ownerPacket\.defaultHostname/.test(staging.defaultHostnameBinding) && /target\.defaultHostname/.test(staging.defaultHostnameBinding) && /actual app\.defaultHostName/.test(staging.defaultHostnameBinding));
check('explicit-gap-punchlist-no-equivalence-claim', JSON.stringify(staging.defaultHostKnownGaps.map(x => x.id)) === JSON.stringify(['content-routes', 'oauth', 'vanity-domain-tls', 'availability'])
  && /No full migration, LIVE equivalence/.test(staging.claims) && /No security waiver/.test(staging.security));
const hostSource = fs.readFileSync(path.resolve(project, 'Program.cs'), 'utf8');
check('protected-api-remains-disabled-no-backend', hostSource.includes('requestPath.StartsWith("/api/", StringComparison.Ordinal)') && hostSource.includes('do not read the body, invoke a backend, or send mail')
  && !/SmtpClient|MailMessage|SendMailAsync|GetSecret|AUTH_READY/.test(hostSource));
const resolverSource = fs.readFileSync(path.join(__dirname, 'release-binding.cjs'), 'utf8');
check('resolver-no-manual-control-digest-gate', !/descriptor\.sha256|Missing fixed receipt identity|Release receipt byte mismatch/.test(resolverSource));
const match = /node <<'NODE'\n([\s\S]*?)\n\s+NODE/.exec(source);
check('inline-precheckout-gate-exists', !!match);
if (match) {
  const code = match[1].split('\n').map(line => line.replace(/^ {10}/, '')).join('\n');
  function inline(env, inputs) { return vm.runInNewContext(code, { process: { env: { GITHUB_EVENT_PATH: 'fixture', ...env } }, require: name => { if (name !== 'node:fs') throw Error('Unexpected inline dependency'); return { readFileSync: () => JSON.stringify({ inputs }) }; } }); }
  const good = { GITHUB_REPOSITORY: contract.repository, GITHUB_REF: 'refs/heads/main', GITHUB_EVENT_NAME: 'workflow_dispatch' };
  for (const environment of ['dev', 'test', 'prod']) { try { inline(good, { environment }); check('inline-valid-choice:' + environment, true); } catch (error) { check('inline-valid-choice:' + environment, false, error.message); } }
  for (const [name, env, inputs] of [
    ['feature-ref', { ...good, GITHUB_REF: 'refs/heads/feature' }, { environment: 'dev' }],
    ['tag-ref', { ...good, GITHUB_REF: 'refs/tags/main' }, { environment: 'dev' }],
    ['fork-repo', { ...good, GITHUB_REPOSITORY: 'fork/repo' }, { environment: 'dev' }],
    ['nonmanual-event', { ...good, GITHUB_EVENT_NAME: 'push' }, { environment: 'dev' }],
    ['extra-target-input', good, { environment: 'dev', target: 'other' }],
    ['invalid-environment', good, { environment: 'production' }]
  ]) { try { inline(env, inputs); check('inline-reject:' + name, false); } catch { check('inline-reject:' + name, true); } }
}
const result = { mode: 'Workflow source/static checks and synthetic inline gate execution only; no actual Actions token or provider proof', workflowSha256: sha(Buffer.from(source)), counts: { pass: rows.filter(r => r.pass).length, fail: rows.filter(r => !r.pass).length, total: rows.length }, rows };
const output = argument('--output'); if (!output) throw Error('--output required'); writeNew(output, result);
console.log(JSON.stringify({ counts: result.counts, failures: rows.filter(r => !r.pass) })); if (result.counts.fail) process.exitCode = 1;
