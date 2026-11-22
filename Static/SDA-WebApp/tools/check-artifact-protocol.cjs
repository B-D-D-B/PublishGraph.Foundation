'use strict';
// Synthetic metadata/bytes/inventory observations only: no real ZIP, run or artifact proof.
const fs = require('node:fs'), path = require('node:path');
const { validate, inventory, objectHash, sha } = require('./validate-artifact-protocol.cjs');
const { fixture: consumerFixture, context } = require('./check-release-binding.cjs');
const consumer = require('./release-binding.cjs');
const contractPath = path.join(__dirname, 'artifact-protocol.json'), realProtocol = JSON.parse(fs.readFileSync(contractPath));
const oid = character => character.repeat(40);
// Seal even deliberately malformed fixtures without invoking the validator under test.
function fixtureInventory(rows, source = false) {
  return rows.map(row => ({ path: row.path, bytes: row.bytes, sha256: row.sha256,
    ...(source ? { gitBlob: row.gitBlob, mode: row.mode } : {}) })).sort((a, b) => a.path.localeCompare(b.path));
}
function fixture() {
  const compatibility = consumerFixture(), zip = compatibility.zip, archive = Buffer.from('SYNTHETIC outer archive bytes; not real ZIP evidence');
  const content = [{ path: 'index.html', bytes: 7, sha256: sha(Buffer.from('fixture')) }, { path: 'assets/app.js', bytes: 2, sha256: sha(Buffer.from('js')) }];
  const runtimeBytes = Buffer.from(JSON.stringify({ files: content, acceptedArtifactManifestSha256: 'c'.repeat(64) }));
  const protocol = structuredClone(realProtocol); protocol.runtime.count = 2; protocol.runtime.contractSha256 = sha(runtimeBytes); protocol.runtime.acceptedArtifactManifestSha256 = 'c'.repeat(64);
  for (const file of Object.keys(protocol.requiredSourceHashes)) protocol.requiredSourceHashes[file] = sha(Buffer.from('fixture source:' + file));
  protocol.requiredSourceHashes['Static/SDA-WebApp/content-contract.json'] = sha(runtimeBytes);
  const protocolSha256 = sha(Buffer.from(JSON.stringify(protocol))), workflow = '.github/workflows/fixture-producer.yml';
  const sourceInputs = [...new Set([...protocol.requiredSourceInputs, workflow])].map(file => ({ path: file, bytes: 10, sha256: protocol.requiredSourceHashes[file] || sha(Buffer.from('fixture source:' + file)), gitBlob: oid('d'), mode: '100644' }));
  sourceInputs.find(row => row.path === 'Static/SDA-WebApp/tools/artifact-protocol.json').sha256 = protocolSha256;
  for (const file of content) sourceInputs.push({ ...file, path: 'Static/SDA-Standalone/' + file.path, gitBlob: oid('e'), mode: '100644' });
  const sourceCommit = oid('a'), sourceTree = oid('b'), workflowSha = sourceInputs.find(row => row.path === workflow).sha256;
  const evidence = { version: 1, repository: protocol.repository, sourceCommit, sourceTree, protocolSha256, producerWorkflowPath: workflow, producerWorkflowSha256: workflowSha,
    sourceInputs, cleanState: { before: { head: sourceCommit, tree: sourceTree, statusBase64: '', statusSha256: sha(Buffer.alloc(0)) }, after: { head: sourceCommit, tree: sourceTree, statusBase64: '', statusSha256: sha(Buffer.alloc(0)) } }, preBuildIgnoredInputs: [],
    toolchain: { dotnet: '10.0.404', node: 'v22.9.0', pwsh: '7.fixture', git: '2.fixture', runnerOs: 'Linux-fixture', runnerArch: 'X64-fixture', runnerImage: 'fixture-image', runnerImageVersion: 'fixture-version', actions: [{ repository: 'actions/upload-artifact', commit: oid('f') }] },
    runId: 100, runAttempt: 1, upload: { artifactId: 200, name: 'fixture-accepted-website', archiveSha256: sha(archive), retentionDays: 30 } };
  const packageReceipt = { sourceCommit, sourceDirty: false, dotnet: evidence.toolchain.dotnet, node: evidence.toolchain.node, startup: 'dotnet /home/site/wwwroot/SDA.Website.dll', package: { path: '/fixture/website.zip', bytes: zip.length, sha256: sha(zip) },
    hostFiles: protocol.hostSourceFiles.map(file => ({ path: file, sha256: sourceInputs.find(row => row.path === protocol.hostSourcePrefix + file).sha256 })),
    content: { contractSha256: protocol.runtime.contractSha256, acceptedArtifactManifestSha256: protocol.runtime.acceptedArtifactManifestSha256, count: 2, files: content },
    archive: [...content.map(file => ({ ...file, path: 'wwwroot/' + file.path })), { path: 'SDA.Website.dll', bytes: 3, sha256: sha(Buffer.from('dll')) }] };
  const expected = { repository: protocol.repository, protocolSha256, sourceCommit, sourceTree, producerWorkflowPath: workflow, producerWorkflowSha256: workflowSha,
    runId: 100, runAttempt: 1, artifactId: 200, artifactName: evidence.upload.name, archiveSha256: sha(archive), zipSha256: sha(zip), retentionDays: 30,
    reviewer: 'fixture-independent-reviewer', worker: 'fixture-producer-worker', functionId: 'fixture-source-build', gateId: 'fixture-R1-R8' };
  const packet = { run: { id: 100, run_attempt: 1, repository: { full_name: protocol.repository }, head_sha: sourceCommit, path: workflow, status: 'completed', conclusion: 'success' },
    artifact: { id: 200, name: expected.artifactName, digest: 'sha256:' + expected.archiveSha256, workflow_run: { id: 100, head_sha: sourceCommit }, expired: false, created_at: '2026-11-22T11:55:00Z', expires_at: '2026-12-22T11:55:00Z' }, observedAtUtc: '2026-11-22T12:00:00Z' };
  const input = { protocol, protocolSha256, runtimeBytes, expected, packet, bundle: { websiteZip: zip, artifactArchive: archive }, observations: {}, now: '2026-11-22T12:02:00Z' };
  function seal() {
    input.bundle.packageReceipt = Buffer.from(JSON.stringify(packageReceipt));
    expected.packageReceiptSha256 = sha(input.bundle.packageReceipt); expected.sourceInputsSha256 = objectHash(fixtureInventory(evidence.sourceInputs, true));
    expected.toolchainSha256 = objectHash(evidence.toolchain); expected.archiveInventorySha256 = objectHash(fixtureInventory(packageReceipt.archive));
    const evidenceBytes = Buffer.from(JSON.stringify(evidence)); expected.producerEvidenceSha256 = sha(evidenceBytes); packet.producerEvidenceBase64 = evidenceBytes.toString('base64');
    expected.observationsSha256 = objectHash({ run: packet.run, artifact: packet.artifact, observedAtUtc: packet.observedAtUtc });
    const acceptance = { kind: protocol.sourceAcceptanceKind, disposition: 'PASS', functionId: expected.functionId, gateId: expected.gateId, reviewer: expected.reviewer, worker: expected.worker, reviewedAtUtc: '2026-11-22T12:01:00Z' };
    for (const field of ['sourceCommit', 'sourceTree', 'protocolSha256', 'producerEvidenceSha256', 'observationsSha256', 'sourceInputsSha256', 'toolchainSha256', 'runId', 'runAttempt', 'artifactId', 'archiveSha256', 'zipSha256', 'packageReceiptSha256', 'archiveInventorySha256']) acceptance[field] = expected[field];
    const acceptanceBytes = Buffer.from(JSON.stringify(acceptance)); expected.acceptanceSha256 = sha(acceptanceBytes); packet.sourceBuildAcceptanceBase64 = acceptanceBytes.toString('base64');
    input.observations = { inner: packageReceipt.archive.map(row => ({ ...row, isLink: false })), outer: [{ path: 'website.zip', bytes: zip.length, sha256: expected.zipSha256 }, { path: 'package.json', bytes: input.bundle.packageReceipt.length, sha256: expected.packageReceiptSha256 }] };
  }
  seal(); return { input, evidence, packageReceipt, compatibility, seal };
}
const rows = [], check = (name, pass, detail) => rows.push({ name, pass: !!pass, ...(pass ? {} : { detail }) });
const good = fixture();
try { check('synthetic-complete-source-build-evidence', validate(good.input).outcome === 'local-contract-checks-pass'); } catch (error) { check('synthetic-complete-source-build-evidence', false, error.message); }
function reject(name, modify, afterSeal = () => {}) {
  const f = fixture(); modify(f); f.seal(); afterSeal(f);
  try { validate(f.input); check(name, false, 'Invalid evidence accepted'); } catch (error) { check(name, true, error.message); }
}
for (const [name, modify] of [
  ['wrong-source-commit', f => { f.evidence.sourceCommit = oid('c'); }], ['wrong-source-tree', f => { f.evidence.sourceTree = oid('c'); }],
  ['dirty-pre-status', f => { f.evidence.cleanState.before.statusBase64 = Buffer.from(' M file\0').toString('base64'); }],
  ['changed-post-head', f => { f.evidence.cleanState.after.head = oid('c'); }], ['missing-clean-evidence', f => { delete f.evidence.cleanState; }],
  ['ignored-stale-build-input', f => { f.evidence.preBuildIgnoredInputs.push('bin/old.dll'); }],
  ['sourceDirty-true', f => { f.packageReceipt.sourceDirty = true; }], ['sourceDirty-string-false', f => { f.packageReceipt.sourceDirty = 'false'; }],
  ['missing-required-source', f => { f.evidence.sourceInputs = f.evidence.sourceInputs.filter(row => row.path !== '.gitattributes'); }],
  ['changed-accepted-builder-source', f => { f.evidence.sourceInputs.find(row => row.path.endsWith('/package.cjs')).sha256 = 'a'.repeat(64); }],
  ['missing-tool-version', f => { delete f.evidence.toolchain.pwsh; }], ['package-node-mismatch', f => { f.packageReceipt.node = 'other'; }],
  ['unpinned-action', f => { f.evidence.toolchain.actions[0].commit = 'v4'; }], ['wrong-content-count', f => { f.packageReceipt.content.count = 3; }],
  ['wrong-content-hash', f => { f.packageReceipt.content.files[0].sha256 = 'a'.repeat(64); }], ['wrong-package-source', f => { f.packageReceipt.sourceCommit = oid('c'); }],
  ['wrong-package-size', f => { f.packageReceipt.package.bytes++; }], ['wrong-host-source', f => { f.packageReceipt.hostFiles[0].sha256 = 'a'.repeat(64); }],
  ['duplicate-inner-entry', f => { f.packageReceipt.archive.push({ ...f.packageReceipt.archive[0] }); }],
  ['traversal-entry', f => { f.packageReceipt.archive[0].path = '../index.html'; }], ['absolute-entry', f => { f.packageReceipt.archive[0].path = '/index.html'; }],
  ['backslash-entry', f => { f.packageReceipt.archive[0].path = 'wwwroot\\index.html'; }], ['unlisted-runtime-entry', f => { f.packageReceipt.archive.push({ path: 'wwwroot/extra', bytes: 0, sha256: sha(Buffer.alloc(0)) }); }],
  ['in-progress-run', f => { f.input.packet.run.status = 'in_progress'; }], ['failed-run', f => { f.input.packet.run.conclusion = 'failure'; }],
  ['wrong-run-id', f => { f.input.packet.run.id++; }], ['wrong-attempt', f => { f.input.packet.run.run_attempt++; }], ['wrong-run-repo', f => { f.input.packet.run.repository.full_name = 'fork/other'; }],
  ['wrong-producer-path', f => { f.input.packet.run.path = '.github/workflows/other.yml'; }], ['wrong-artifact-id', f => { f.input.packet.artifact.id++; }],
  ['wrong-artifact-name', f => { f.input.packet.artifact.name = 'latest'; }], ['wrong-artifact-run-link', f => { f.input.packet.artifact.workflow_run.id++; }],
  ['expired-flag', f => { f.input.packet.artifact.expired = true; }], ['missing-expiry', f => { delete f.input.packet.artifact.expires_at; }],
  ['expiry-at-current-time', f => { f.input.packet.artifact.expires_at = f.input.now; }], ['past-expiry', f => { f.input.packet.artifact.expires_at = '2026-11-22T11:59:00Z'; }],
  ['invalid-time-order', f => { f.input.packet.artifact.created_at = '2026-11-22T12:03:00Z'; }], ['future-observation', f => { f.input.packet.observedAtUtc = '2026-11-22T12:03:00Z'; }],
  ['missing-retention', f => { delete f.input.expected.retentionDays; }], ['upload-id-mismatch', f => { f.evidence.upload.artifactId++; }]
]) reject(name, modify);
for (const [name, mutate] of [
  ['archive-vs-inner-digest-confusion', f => { f.input.packet.artifact.digest = 'sha256:' + f.input.expected.zipSha256; }],
  ['corrupt-outer-bytes', f => { f.input.bundle.artifactArchive = Buffer.from('changed'); }], ['corrupt-payload-bytes', f => { f.input.bundle.websiteZip = Buffer.from('changed'); }],
  ['corrupt-raw-package-bytes', f => { f.input.bundle.packageReceipt = Buffer.from('{}'); }], ['missing-artifact', f => { delete f.input.packet.artifact; }],
  ['missing-independent-acceptance', f => { delete f.input.packet.sourceBuildAcceptanceBase64; }],
  ['mutated-observed-expiry-after-review', f => { f.input.packet.artifact.expires_at = '2027-01-01T00:00:00Z'; }],
  ['outer-unlisted-entry', f => { f.input.observations.outer.push({ path: 'extra.json', bytes: 0, sha256: sha(Buffer.alloc(0)) }); }],
  ['observed-inner-byte-mismatch', f => { f.input.observations.inner[0].sha256 = 'f'.repeat(64); }], ['observed-symlink', f => { f.input.observations.inner[0].isLink = true; }]
]) reject(name, () => {}, mutate);
for (const [name, mutate] of [
  ['acceptance-nonPASS', value => { value.disposition = 'REMEDIATE'; }], ['acceptance-boolean-not-proof', value => { delete value.disposition; value.ready = true; }],
  ['acceptance-wrong-artifact', value => { value.artifactId++; }], ['acceptance-wrong-protocol', value => { value.protocolSha256 = 'a'.repeat(64); }],
  ['acceptance-wrong-reviewer', value => { value.reviewer = 'other'; }], ['acceptance-before-observation', value => { value.reviewedAtUtc = '2026-11-22T11:59:00Z'; }]
]) reject(name, () => {}, f => { const value = JSON.parse(Buffer.from(f.input.packet.sourceBuildAcceptanceBase64, 'base64')); mutate(value); const bytes = Buffer.from(JSON.stringify(value)); f.input.packet.sourceBuildAcceptanceBase64 = bytes.toString('base64'); f.input.expected.acceptanceSha256 = sha(bytes); });
const projected = fixture(), b = projected.compatibility.contract.environments.dev, descriptor = b.receipts.artifactAcceptance;
const wrapper = JSON.parse(projected.compatibility.files.get(descriptor.path)); wrapper.sourceBuildAcceptanceSha256 = projected.input.expected.acceptanceSha256;
const wrapperBytes = Buffer.from(JSON.stringify(wrapper)); projected.input.packet.consumerProjectionBase64 = wrapperBytes.toString('base64');
projected.input.expected.projection = { sha256: sha(wrapperBytes), environment: wrapper.environment, appId: wrapper.appId, functionId: wrapper.functionId, gateId: wrapper.gateId };
try {
  validate(projected.input); projected.compatibility.files.set(descriptor.path, wrapperBytes); descriptor.sha256 = sha(wrapperBytes);
  b.artifact.packageReceiptSha256 = projected.input.expected.packageReceiptSha256;
  const selection = consumer.resolveBinding(projected.compatibility.contract, 'dev', context('dev'), projected.compatibility.read);
  const fileSystem = { readdirSync: () => ['package.json', 'website.zip'], lstatSync: () => ({ isFile: () => true, isSymbolicLink: () => false }), readFileSync: file => file.endsWith('package.json') ? projected.input.bundle.packageReceipt : projected.input.bundle.websiteZip };
  check('synthetic-current-consumer-wrapper-and-bundle', consumer.verifyArtifact(selection, '/synthetic-only', fileSystem).zipSha256 === projected.input.expected.zipSha256);
} catch (error) { check('synthetic-current-consumer-wrapper-and-bundle', false, error.message); }
const runtimeBytes = fs.readFileSync(path.resolve(__dirname, '../../../', realProtocol.runtime.contractPath));
check('real452-content-contract-pinned-without-runtime-rerun', realProtocol.runtime.count === 452 && sha(runtimeBytes) === realProtocol.runtime.contractSha256 && JSON.parse(runtimeBytes).files.length === 452);
check('no-actual-producer-bound', realProtocol.actualProducer === null);
const result = { mode: 'Synthetic fixture bytes, clock and archive/API observations only; no actual ZIP inspection, producer workflow/run/artifact, provider or independent acceptance is proven', contractSha256: sha(fs.readFileSync(contractPath)), validatorSha256: sha(fs.readFileSync(path.join(__dirname, 'validate-artifact-protocol.cjs'))), counts: { pass: rows.filter(row => row.pass).length, fail: rows.filter(row => !row.pass).length, total: rows.length }, rows };
const at = process.argv.indexOf('--output'), output = at < 0 ? null : process.argv[at + 1]; if (!output || fs.existsSync(output)) throw Error('Fresh output report required');
fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ counts: result.counts, failures: rows.filter(row => !row.pass) })); if (result.counts.fail) process.exitCode = 1;
