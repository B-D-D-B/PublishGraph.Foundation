'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), cp = require('node:child_process');
const protocolPath = path.join(__dirname, 'artifact-protocol.json');
const root = path.resolve(__dirname, '../../..');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const digest = value => /^[a-f0-9]{64}$/.test(value || '');
const oid = value => /^[a-f0-9]{40}$/.test(value || '');
function requireValue(value, message) { if (!value) throw Error(message); }
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
const objectHash = value => sha(Buffer.from(canonical(value)));
function inventory(rows, source = false) {
  requireValue(Array.isArray(rows), 'Inventory is missing');
  const names = new Set();
  return rows.map(row => {
    requireValue(typeof row.path === 'string' && !row.path.includes('\\') && !row.path.includes('\0')
      && !path.posix.isAbsolute(row.path) && !/^[a-z]:/i.test(row.path) && path.posix.normalize(row.path) === row.path
      && !row.path.split('/').some(part => !part || part === '.' || part === '..') && !names.has(row.path), 'Unsafe or duplicate inventory path');
    names.add(row.path);
    requireValue(Number.isSafeInteger(row.bytes) && row.bytes >= 0 && digest(row.sha256) && row.isLink !== true, 'Invalid inventory size/hash/link');
    const value = { path: row.path, bytes: row.bytes, sha256: row.sha256 };
    if (source) {
      requireValue(oid(row.gitBlob) && ['100644', '100755'].includes(row.mode), 'Source Git blob/mode missing');
      value.gitBlob = row.gitBlob; value.mode = row.mode;
    }
    return value;
  }).sort((a, b) => a.path.localeCompare(b.path));
}
function decoded(value, expectedHash, label) {
  requireValue(typeof value === 'string' && digest(expectedHash), label + ' bytes/hash missing');
  const bytes = Buffer.from(value, 'base64');
  requireValue(bytes.toString('base64') === value && sha(bytes) === expectedHash, label + ' byte identity mismatch');
  return { bytes, data: JSON.parse(bytes) };
}
function timestamp(value, label) { const time = Date.parse(value); requireValue(typeof value === 'string' && Number.isFinite(time), label + ' timestamp missing'); return time; }
function validateMetadata(input) {
  const { protocol, protocolSha256, runtimeBytes, expected: e, packet, bundle, now } = input;
  requireValue(protocol.version === 1 && protocol.repository === 'B-D-D-B/PublishGraph.Foundation' && e.protocolSha256 === protocolSha256, 'Protocol identity mismatch');
  requireValue(sha(runtimeBytes) === protocol.runtime.contractSha256, 'Runtime contract byte identity mismatch');
  const runtime = JSON.parse(runtimeBytes), files = inventory(runtime.files);
  requireValue(files.length === protocol.runtime.count && runtime.acceptedArtifactManifestSha256 === protocol.runtime.acceptedArtifactManifestSha256, 'Runtime content identity mismatch');
  requireValue(e.repository === protocol.repository && oid(e.sourceCommit) && oid(e.sourceTree)
    && /^\.github\/workflows\/[a-zA-Z0-9._-]+\.ya?ml$/.test(e.producerWorkflowPath) && digest(e.producerWorkflowSha256), 'Reviewed source/producer identity missing');
  const evidence = decoded(packet.producerEvidenceBase64, e.producerEvidenceSha256, 'Producer evidence').data;
  requireValue(evidence.version === protocol.evidenceVersion && evidence.repository === e.repository && evidence.sourceCommit === e.sourceCommit
    && evidence.sourceTree === e.sourceTree && evidence.protocolSha256 === protocolSha256
    && evidence.producerWorkflowPath === e.producerWorkflowPath && evidence.producerWorkflowSha256 === e.producerWorkflowSha256, 'Producer source/tree/workflow linkage mismatch');
  for (const state of [evidence.cleanState?.before, evidence.cleanState?.after]) {
    requireValue(state && state.head === e.sourceCommit && state.tree === e.sourceTree && state.statusBase64 === ''
      && state.statusSha256 === sha(Buffer.alloc(0)), 'Raw clean-state/HEAD/tree evidence mismatch');
  }
  requireValue(Array.isArray(evidence.preBuildIgnoredInputs) && evidence.preBuildIgnoredInputs.length === 0, 'Ignored pre-build input inventory is not empty');
  const inputs = inventory(evidence.sourceInputs, true), inputMap = new Map(inputs.map(row => [row.path, row]));
  requireValue(objectHash(inputs) === e.sourceInputsSha256, 'Reviewed source input inventory mismatch');
  for (const file of [...protocol.requiredSourceInputs, e.producerWorkflowPath]) requireValue(inputMap.has(file), 'Required source input missing: ' + file);
  for (const [file, hash] of Object.entries(protocol.requiredSourceHashes)) requireValue(inputMap.get(file)?.sha256 === hash, 'Accepted build source hash mismatch');
  requireValue(inputMap.get('Static/SDA-WebApp/tools/artifact-protocol.json').sha256 === protocolSha256, 'Source protocol hash mismatch');
  requireValue(inputMap.get(e.producerWorkflowPath).sha256 === e.producerWorkflowSha256, 'Producer workflow source blob hash mismatch');
  for (const field of protocol.toolchainFields) requireValue(typeof evidence.toolchain?.[field] === 'string' && evidence.toolchain[field].length > 0, 'Exact observed toolchain field missing');
  requireValue(Array.isArray(evidence.toolchain.actions) && evidence.toolchain.actions.length > 0
    && evidence.toolchain.actions.every(action => /^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/.test(action.repository) && oid(action.commit))
    && objectHash(evidence.toolchain) === e.toolchainSha256, 'Reviewed toolchain/action pin mismatch');
  const packageBytes = bundle.packageReceipt, packageReceipt = JSON.parse(packageBytes);
  requireValue(sha(bundle.artifactArchive) === e.archiveSha256 && sha(bundle.websiteZip) === e.zipSha256 && sha(packageBytes) === e.packageReceiptSha256, 'Archive/ZIP/raw package byte identity mismatch');
  requireValue(packageReceipt.sourceCommit === e.sourceCommit && packageReceipt.sourceDirty === false
    && packageReceipt.dotnet === evidence.toolchain.dotnet && packageReceipt.node === evidence.toolchain.node
    && packageReceipt.startup === 'dotnet /home/site/wwwroot/SDA.Website.dll'
    && packageReceipt.package?.sha256 === e.zipSha256 && packageReceipt.package.bytes === bundle.websiteZip.length, 'Package source/clean/toolchain/payload linkage mismatch');
  const host = inventory(packageReceipt.hostFiles.map(file => ({ ...file, bytes: inputMap.get(protocol.hostSourcePrefix + file.path)?.bytes })));
  requireValue(JSON.stringify(host.map(row => row.path)) === JSON.stringify([...protocol.hostSourceFiles].sort((a, b) => a.localeCompare(b))), 'Host source inventory mismatch');
  for (const file of host) requireValue(inputMap.get(protocol.hostSourcePrefix + file.path)?.sha256 === file.sha256, 'Host source hash mismatch');
  const content = packageReceipt.content;
  requireValue(content?.contractSha256 === protocol.runtime.contractSha256 && content.acceptedArtifactManifestSha256 === protocol.runtime.acceptedArtifactManifestSha256
    && content.count === files.length && canonical(inventory(content.files)) === canonical(files), 'Package content manifest mismatch');
  for (const file of files) {
    const source = inputMap.get('Static/SDA-Standalone/' + file.path);
    requireValue(source && source.sha256 === file.sha256 && source.bytes === file.bytes, 'Runtime source input mismatch');
  }
  const inner = inventory(packageReceipt.archive);
  requireValue(objectHash(inner) === e.archiveInventorySha256 && !inner.some(row => /\.(exe|cs|csproj)$/.test(row.path) || row.path.startsWith('tools/')), 'Reviewed portable ZIP inventory mismatch');
  const webroot = inner.filter(row => row.path.startsWith('wwwroot/')).map(row => ({ ...row, path: row.path.slice(8) }));
  requireValue(canonical(webroot) === canonical(files), 'ZIP runtime inventory mismatch');
  const run = packet.run, artifact = packet.artifact;
  requireValue(Number.isSafeInteger(e.runId) && e.runId > 0 && Number.isSafeInteger(e.runAttempt) && e.runAttempt > 0
    && run?.id === e.runId && run.run_attempt === e.runAttempt && run.repository?.full_name === e.repository
    && run.head_sha === e.sourceCommit && run.path === e.producerWorkflowPath && run.status === 'completed' && run.conclusion === 'success', 'Successful exact producer run missing');
  requireValue(Number.isSafeInteger(e.artifactId) && e.artifactId > 0 && typeof e.artifactName === 'string' && /^[a-zA-Z0-9._-]+$/.test(e.artifactName)
    && artifact?.id === e.artifactId && artifact.name === e.artifactName && artifact.workflow_run?.id === e.runId
    && artifact.workflow_run?.head_sha === e.sourceCommit && artifact.digest === 'sha256:' + e.archiveSha256 && artifact.expired === false, 'Exact immutable artifact linkage missing');
  requireValue(objectHash({ run, artifact, observedAtUtc: packet.observedAtUtc }) === e.observationsSha256, 'Fixed run/artifact/expiry observation identity mismatch');
  requireValue(evidence.runId === e.runId && evidence.runAttempt === e.runAttempt && evidence.upload?.artifactId === e.artifactId
    && evidence.upload.name === e.artifactName && evidence.upload.archiveSha256 === e.archiveSha256, 'Producer upload/run observation mismatch');
  const current = timestamp(now, 'Validation'), created = timestamp(artifact.created_at, 'Artifact creation'), expires = timestamp(artifact.expires_at, 'Artifact expiry'), observed = timestamp(packet.observedAtUtc, 'Observation');
  requireValue(Number.isInteger(e.retentionDays) && e.retentionDays > 0 && evidence.upload.retentionDays === e.retentionDays
    && created <= observed && observed <= current && expires > created && expires > current, 'Retention/expiry/observation invalid or expired');
  const acceptance = decoded(packet.sourceBuildAcceptanceBase64, e.acceptanceSha256, 'Independent acceptance').data;
  requireValue(acceptance.kind === protocol.sourceAcceptanceKind && acceptance.disposition === 'PASS'
    && typeof e.reviewer === 'string' && e.reviewer && e.reviewer !== e.worker && acceptance.reviewer === e.reviewer && acceptance.worker === e.worker
    && typeof e.functionId === 'string' && e.functionId && typeof e.gateId === 'string' && e.gateId
    && acceptance.functionId === e.functionId && acceptance.gateId === e.gateId, 'Independent source/build PASS linkage missing');
  for (const field of ['sourceCommit', 'sourceTree', 'protocolSha256', 'producerEvidenceSha256', 'observationsSha256', 'sourceInputsSha256', 'toolchainSha256', 'runId', 'runAttempt', 'artifactId', 'archiveSha256', 'zipSha256', 'packageReceiptSha256', 'archiveInventorySha256'])
    requireValue(acceptance[field] === e[field], 'Independent acceptance target mismatch: ' + field);
  const reviewed = timestamp(acceptance.reviewedAtUtc, 'Independent review');
  requireValue(reviewed >= observed && reviewed <= current, 'Independent review time mismatch');
  if (packet.consumerProjectionBase64 !== undefined) {
    const projection = decoded(packet.consumerProjectionBase64, e.projection?.sha256, 'Consumer projection').data;
    requireValue(projection.kind === protocol.consumerAcceptanceKind && projection.disposition === 'PASS'
      && projection.environment === e.projection.environment && projection.appId === e.projection.appId
      && projection.functionId === e.projection.functionId && projection.gateId === e.projection.gateId
      && projection.sourceCommit === e.sourceCommit && projection.artifactSha256 === e.zipSha256
      && projection.sourceBuildAcceptanceSha256 === e.acceptanceSha256, 'Consumer projection/source acceptance linkage mismatch');
  }
  return { inner, outer: inventory([{ path: 'website.zip', bytes: bundle.websiteZip.length, sha256: e.zipSha256 }, { path: 'package.json', bytes: packageBytes.length, sha256: e.packageReceiptSha256 }]) };
}
function validate(input) {
  const expected = validateMetadata(input);
  requireValue(canonical(inventory(input.observations.outer)) === canonical(expected.outer), 'Observed outer artifact inventory mismatch');
  requireValue(canonical(inventory(input.observations.inner)) === canonical(expected.inner), 'Observed inner ZIP inventory mismatch');
  return { outcome: 'local-contract-checks-pass', checkedAtUtc: input.now, protocolSha256: input.protocolSha256, sourceCommit: input.expected.sourceCommit,
    sourceTree: input.expected.sourceTree, runId: input.expected.runId, artifactId: input.expected.artifactId, limits: 'Checks supplied local evidence only; no independent acceptance is awarded or producer/cloud effect performed.' };
}
function inspectArchive(file, expected) {
  const script = `$r=[Console]::In.ReadToEnd()|ConvertFrom-Json; Add-Type -AssemblyName System.IO.Compression; $z=[System.IO.Compression.ZipFile]::OpenRead($r.path); try { if($z.Entries.Count -ne $r.entries.Count){throw 'ZIP entry count differs from fixed inventory'}; $rows=@($z.Entries|ForEach-Object { $e=$_; $match=@($r.entries|Where-Object path -CEQ $e.FullName); if($match.Count -ne 1 -or $match[0].bytes -ne $e.Length){throw 'ZIP entry name/size differs from fixed inventory'}; $link=((($e.ExternalAttributes -shr 16) -band 0xF000) -eq 0xA000); if($link){throw 'ZIP link forbidden'}; $s=$e.Open(); try { [pscustomobject]@{path=$e.FullName;bytes=$e.Length;sha256=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($s)).ToLowerInvariant();isLink=$link} } finally {$s.Dispose()} }); ConvertTo-Json -InputObject $rows -Depth 4 -Compress } finally {$z.Dispose()}`;
  const result = cp.spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', script], { input: JSON.stringify({ path: path.resolve(file), entries: expected }), encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });
  requireValue(result.status === 0, 'Read-only local ZIP inspection failed: ' + (result.stderr || result.error?.message || 'unknown'));
  return JSON.parse(result.stdout);
}
function argument(name) { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; }
function main() {
  const output = argument('--output'); requireValue(output && !fs.existsSync(output), 'Fresh output report required');
  let report;
  try {
    const protocolBytes = fs.readFileSync(protocolPath), protocol = JSON.parse(protocolBytes), directory = argument('--bundle');
    requireValue(JSON.stringify(fs.readdirSync(directory).sort()) === JSON.stringify(protocol.bundleFiles), 'Exact two-file bundle required');
    for (const file of protocol.bundleFiles) requireValue(fs.lstatSync(path.join(directory, file)).isFile() && !fs.lstatSync(path.join(directory, file)).isSymbolicLink(), 'Bundle file/link invalid');
    const input = { protocol, protocolSha256: sha(protocolBytes), runtimeBytes: fs.readFileSync(path.join(root, protocol.runtime.contractPath)),
      expected: JSON.parse(fs.readFileSync(argument('--expected'))), packet: JSON.parse(fs.readFileSync(argument('--packet'))), now: new Date().toISOString(),
      bundle: { artifactArchive: fs.readFileSync(argument('--archive')), websiteZip: fs.readFileSync(path.join(directory, 'website.zip')), packageReceipt: fs.readFileSync(path.join(directory, 'package.json')) } };
    const expected = validateMetadata(input);
    input.observations = { outer: inspectArchive(argument('--archive'), expected.outer), inner: inspectArchive(path.join(directory, 'website.zip'), expected.inner) };
    report = validate(input);
  } catch (error) { report = { outcome: 'local-contract-checks-fail', error: error.message, limits: 'No independent acceptance or producer/cloud effect' }; process.exitCode = 1; }
  fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify(report));
}
module.exports = { validate, validateMetadata, inspectArchive, inventory, objectHash, canonical, sha };
if (require.main === module) main();
