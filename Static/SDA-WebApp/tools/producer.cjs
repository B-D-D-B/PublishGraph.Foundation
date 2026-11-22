'use strict';
// Build facts and read-only observations. This program cannot award acceptance.
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process');
const { sha, inventory, canonical, inspectArchive } = require('./validate-artifact-protocol.cjs');
const root = path.resolve(__dirname, '../../..');
const workflow = '.github/workflows/build-sda-website.yml';
const repository = 'B-D-D-B/PublishGraph.Foundation';
const prefix = 'artifacts/SDA-WEBAPP-PRODUCER-01/';
const controlInputs = ['global.json', 'Directory.Build.props', 'Directory.Packages.props', 'NuGet.Config'];
const cap = 200 * 1024 * 1024, evidenceCap = 2 * 1024 * 1024;
const actions = [
  { repository: 'actions/checkout', commit: '11d5960a326750d5838078e36cf38b85af677262' },
  { repository: 'actions/setup-node', commit: '49933ea5288caeca8642d1e84afbd3f7d6820020' },
  { repository: 'actions/setup-dotnet', commit: '67a3573c9a986a3f9c594539f4ab511d57bb3ce9' },
  { repository: 'actions/upload-artifact', commit: 'ea165f8d65b6e75b540449e92b4886f43607fa02' }
];
function need(value, message) { if (!value) throw Error(message); }
function exec(command, args, cwd = root, options = {}) { return cp.execFileSync(command, args, { cwd, maxBuffer: 8 * 1024 * 1024, ...options }); }
function git(args, cwd = root) { return exec('git', args, cwd); }
function text(command, args, cwd = root) { return exec(command, args, cwd).toString().trim(); }
const oid = value => /^[a-f0-9]{40}$/.test(value || '');
const digest = value => /^[a-f0-9]{64}$/.test(value || '');
function number(value) { const n = Number(value); need(Number.isSafeInteger(n) && n > 0, 'Positive safe integer required'); return n; }
function context(env, head) {
  need(env.GITHUB_REPOSITORY === repository && env.GITHUB_EVENT_NAME === 'push', 'Only this repository push is allowed');
  need(['refs/heads/main', 'refs/heads/agents/sda-website-migration-setup'].includes(env.GITHUB_REF), 'Unreviewed producer ref');
  need(oid(env.GITHUB_SHA) && env.GITHUB_SHA === head, 'Exact checked-out push SHA required');
  need(env.GITHUB_WORKFLOW_REF === repository + '/' + workflow + '@' + env.GITHUB_REF, 'Producer workflow identity mismatch');
  return { runId: number(env.GITHUB_RUN_ID), runAttempt: number(env.GITHUB_RUN_ATTEMPT), ref: env.GITHUB_REF };
}
function checkTools(toolchain, executable, installation) {
  need(toolchain.dotnet === '10.0.404' && toolchain.node === 'v22.9.0', 'Pinned SDK/node version mismatch');
  const relative = path.relative(fs.realpathSync(installation), fs.realpathSync(executable));
  need(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'SDK executable outside isolated installation');
  for (const field of ['pwsh', 'git', 'runnerOs', 'runnerArch', 'runnerImage', 'runnerImageVersion'])
    need(typeof toolchain[field] === 'string' && toolchain[field].length > 0, 'Observed toolchain field missing: ' + field);
  return toolchain;
}
function cleanState(cwd = root) {
  const status = git(['status', '--porcelain=v1', '--untracked-files=all'], cwd);
  const state = { head: text('git', ['rev-parse', 'HEAD'], cwd), tree: text('git', ['rev-parse', 'HEAD^{tree}'], cwd), statusBase64: status.toString('base64'), statusSha256: sha(status) };
  need(status.length === 0 && oid(state.head) && oid(state.tree), 'Actual raw Git state is not clean');
  return state;
}
function ignoredInputs(cwd = root) {
  const names = git(['ls-files', '--others', '--ignored', '--exclude-standard', '-z'], cwd).toString().split('\0').filter(Boolean);
  need(names.length === 0, 'Ignored pre-build inputs are not empty');
  return names;
}
function sourceInputs(paths, cwd = root) {
  const tracked = new Map(git(['ls-files', '--stage', '-z'], cwd).toString().split('\0').filter(Boolean).map(row => {
    const match = /^(\d+) ([a-f0-9]{40}) (\d)\t(.+)$/.exec(row); need(match && match[3] === '0', 'Unmerged or malformed index');
    return [match[4], { mode: match[1], gitBlob: match[2] }];
  }));
  return inventory([...new Set(paths)].map(file => {
    const index = tracked.get(file); need(index && ['100644', '100755'].includes(index.mode), 'Missing/untracked/link source: ' + file);
    const full = path.join(cwd, file), stat = fs.lstatSync(full); need(stat.isFile() && !stat.isSymbolicLink(), 'Linked/non-file source');
    const bytes = fs.readFileSync(full);
    const blob = cp.execFileSync('git', ['hash-object', '--no-filters', '--stdin'], { cwd, input: bytes, encoding: 'utf8' }).trim();
    need(blob === index.gitBlob, 'Source bytes differ from index: ' + file);
    return { path: file, bytes: bytes.length, sha256: sha(bytes), ...index };
  }), true);
}
function outputPath(relative) {
  need(typeof relative === 'string' && relative.startsWith(prefix) && path.posix.normalize(relative) === relative && !relative.includes('\\'), 'Output outside owned ignored prefix');
  const full = path.join(root, relative);
  for (let cursor = path.dirname(full); cursor !== root; cursor = path.dirname(cursor))
    if (fs.existsSync(cursor)) need(!fs.lstatSync(cursor).isSymbolicLink(), 'Linked output parent');
  return full;
}
function write(relative, value) {
  const file = outputPath(relative); fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' }); return file;
}
function json(relative) { return JSON.parse(fs.readFileSync(outputPath(relative))); }
function protocol() {
  const file = path.join(__dirname, 'artifact-protocol.json'), bytes = fs.readFileSync(file);
  const value = JSON.parse(bytes), runtime = fs.readFileSync(path.join(root, value.runtime.contractPath));
  need(sha(runtime) === value.runtime.contractSha256, 'Runtime contract changed');
  return { value, sha256: sha(bytes), runtime: JSON.parse(runtime) };
}
function inputPaths(p) {
  return [...p.value.requiredSourceInputs, ...controlInputs, workflow, 'Static/SDA-WebApp/tools/producer.cjs', '.gitignore', ...p.runtime.files.map(row => 'Static/SDA-Standalone/' + row.path)];
}
function prepare(env = process.env) {
  const before = cleanState(), run = context(env, before.head), ignored = ignoredInputs(), p = protocol();
  const toolchain = {
    dotnet: text('dotnet', ['--version']), node: process.version,
    pwsh: text('pwsh', ['-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.ToString()']), git: text('git', ['--version']),
    runnerOs: env.RUNNER_OS, runnerArch: env.RUNNER_ARCH, runnerImage: env.ImageOS, runnerImageVersion: env.ImageVersion, actions
  };
  checkTools(toolchain, text('which', ['dotnet']), env.DOTNET_INSTALL_DIR);
  const inputs = sourceInputs(inputPaths(p));
  const byPath = new Map(inputs.map(row => [row.path, row]));
  for (const [file, hash] of Object.entries(p.value.requiredSourceHashes)) need(byPath.get(file)?.sha256 === hash, 'Protected producer input changed');
  need(p.runtime.files.length === 452, 'Accepted content count differs');
  for (const row of p.runtime.files) need(byPath.get('Static/SDA-Standalone/' + row.path)?.sha256 === row.sha256 && byPath.get('Static/SDA-Standalone/' + row.path)?.bytes === row.bytes, 'Accepted content input differs');
  return { version: 1, repository, sourceCommit: before.head, sourceTree: before.tree, protocolSha256: p.sha256, producerWorkflowPath: workflow,
    producerWorkflowSha256: byPath.get(workflow).sha256, cleanState: { before }, preBuildIgnoredInputs: ignored, sourceInputs: inputs, toolchain, runId: run.runId, runAttempt: run.runAttempt };
}
function verifyPackage(evidence, receipt, zipBytes, runtime) {
  need(receipt.sourceCommit === evidence.sourceCommit && receipt.sourceDirty === false, 'Package source is dirty or mismatched');
  need(receipt.dotnet === evidence.toolchain.dotnet && receipt.node === evidence.toolchain.node, 'Package toolchain differs');
  need(receipt.startup === 'dotnet /home/site/wwwroot/SDA.Website.dll', 'Portable startup differs');
  need(zipBytes.length <= cap && receipt.package?.bytes === zipBytes.length && receipt.package.sha256 === sha(zipBytes), 'Payload ZIP digest/size differs');
  const inputs = new Map(evidence.sourceInputs.map(row => [row.path, row]));
  need(canonical(receipt.hostFiles.map(row => row.path).sort()) === canonical(['Program.cs', 'SDA.Website.csproj', 'content-contract.json'].sort()), 'Host file set differs');
  for (const row of receipt.hostFiles) need(inputs.get('Static/SDA-WebApp/' + row.path)?.sha256 === row.sha256, 'Host input hash differs');
  const p = protocol().value;
  need(receipt.content?.contractSha256 === p.runtime.contractSha256 && receipt.content.acceptedArtifactManifestSha256 === p.runtime.acceptedArtifactManifestSha256
    && receipt.content.count === runtime.files.length && canonical(inventory(receipt.content.files)) === canonical(inventory(runtime.files)), 'Content receipt differs');
  const rows = inventory(receipt.archive);
  need(!rows.some(row => /\.(exe|cs|csproj)$/.test(row.path) || row.path.startsWith('tools/')), 'Nonportable ZIP payload');
  const content = rows.filter(row => row.path.startsWith('wwwroot/')).map(row => ({ ...row, path: row.path.slice(8) }));
  need(canonical(content) === canonical(inventory(runtime.files)), 'ZIP runtime inventory differs');
  return rows;
}
function verifyBuild(evidence, directory) {
  const before = evidence.cleanState.before, after = cleanState();
  need(after.head === before.head && after.tree === before.tree && before.statusBase64 === '' && before.statusSha256 === sha(Buffer.alloc(0)), 'Pre/post source differs');
  const packagePath = outputPath(directory + '/package.json'), zipPath = outputPath(directory + '/website.zip');
  need(fs.statSync(packagePath).size <= evidenceCap, 'Package receipt too large');
  const receipt = JSON.parse(fs.readFileSync(packagePath)), zip = fs.readFileSync(zipPath);
  need(zip.length + fs.statSync(packagePath).size <= cap, 'Combined bundle exceeds cap');
  const rows = verifyPackage(evidence, receipt, zip, protocol().runtime);
  need(canonical(inventory(inspectArchive(zipPath, rows))) === canonical(rows), 'Actual ZIP differs from receipt');
  return { ...evidence, cleanState: { before, after } };
}
function artifactName(evidence) { return `sda-website-${evidence.sourceCommit}-${evidence.runId}-${evidence.runAttempt}`; }
function recordUpload(evidence, id, digestValue) {
  need(evidence.cleanState?.after?.statusBase64 === '' && evidence.cleanState.before.statusBase64 === '', 'Verified clean build missing');
  const hash = digestValue?.replace(/^sha256:/, ''); need(digest(hash), 'Native upload archive digest missing');
  need(!('conclusion' in evidence) && !('disposition' in evidence) && !('upload' in evidence), 'Producer must not self-complete or overwrite upload');
  const result = { ...evidence, upload: { artifactId: number(id), name: artifactName(evidence), archiveSha256: hash, retentionDays: 7 } };
  need(Buffer.byteLength(JSON.stringify(result, null, 2) + '\n') <= evidenceCap, 'Supplementary evidence exceeds cap');
  return result;
}
function observedArtifacts(run, artifacts, fixed, now) {
  need(fixed.repository === repository && oid(fixed.sourceCommit) && oid(fixed.sourceTree) && digest(fixed.producerWorkflowSha256)
    && fixed.producerWorkflowPath === workflow && ['main', 'agents/sda-website-migration-setup'].includes(fixed.branch), 'Fixed reviewed observer identity missing');
  need(run.repository?.full_name === repository && run.head_sha === fixed.sourceCommit && run.head_branch === fixed.branch && run.event === 'push'
    && run.path === workflow && run.run_attempt === 1 && run.status === 'completed' && run.conclusion === 'success', 'Exact completed successful push run missing');
  number(run.id);
  const name = artifactName({ sourceCommit: fixed.sourceCommit, runId: run.id, runAttempt: 1 });
  need(artifacts.length === 2, 'Exactly two producer artifacts required');
  return [name, name + '-evidence'].map((expectedName, index) => {
    const matches = artifacts.filter(row => row.name === expectedName); need(matches.length === 1, 'Missing/duplicate named artifact'); const row = matches[0];
    number(row.id); need(row.workflow_run?.id === run.id && row.workflow_run.head_sha === fixed.sourceCommit && /^sha256:[a-f0-9]{64}$/.test(row.digest || '') && row.expired === false, 'Artifact/run/digest mismatch');
    need(Number.isSafeInteger(row.size_in_bytes) && row.size_in_bytes > 0 && row.size_in_bytes <= (index ? evidenceCap : cap), 'Artifact exceeds download cap');
    const created = Date.parse(row.created_at), expires = Date.parse(row.expires_at);
    need(Number.isFinite(created) && Number.isFinite(expires) && created <= now && expires > now && expires > created, 'Artifact expiry invalid');
    return row;
  });
}
// Extract only fixed leaf names, bounded by metadata and decompressed size; never trust ZIP paths.
function unpack(file, directory, names, limit) {
  need(!fs.existsSync(directory), 'Fresh extraction directory required');
  const script = `$r=[Console]::In.ReadToEnd()|ConvertFrom-Json; Add-Type -AssemblyName System.IO.Compression; $z=[System.IO.Compression.ZipFile]::OpenRead($r.file); try { if($z.Entries.Count -ne $r.names.Count){throw 'Unexpected entry count'}; $total=0L; foreach($e in $z.Entries){if($r.names -cnotcontains $e.FullName -or (($e.ExternalAttributes -shr 16) -band 0xF000) -eq 0xA000){throw 'Unexpected name/link'}; $total+=$e.Length}; if($total -gt $r.limit){throw 'Expanded ZIP exceeds cap'}; [IO.Directory]::CreateDirectory($r.directory)|Out-Null; foreach($name in $r.names){$matches=@($z.Entries|Where-Object FullName -CEQ $name); if($matches.Count -ne 1){throw 'Duplicate/missing entry'}; $s=$matches[0].Open(); $o=[IO.File]::Open([IO.Path]::Combine($r.directory,$name),[IO.FileMode]::CreateNew); try{$s.CopyTo($o)}finally{$o.Dispose();$s.Dispose()}} } finally{$z.Dispose()}`;
  const r = cp.spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', script], { input: JSON.stringify({ file, directory, names, limit }), encoding: 'utf8' });
  need(r.status === 0, 'Bounded ZIP extraction failed: ' + (r.stderr || r.error?.message || 'unknown'));
}
function observe(fixed, directory) {
  const out = outputPath(directory); need(!fs.existsSync(out), 'Fresh observer directory required');
  const api = endpoint => JSON.parse(text('gh', ['api', endpoint]));
  need(oid(fixed.sourceCommit), 'Exact source SHA missing');
  const observerState = cleanState();
  need(observerState.head === fixed.sourceCommit && observerState.tree === fixed.sourceTree
    && sha(fs.readFileSync(path.join(root, workflow))) === fixed.producerWorkflowSha256, 'Observer checkout differs from fixed reviewed source');
  const runs = api(`repos/${repository}/actions/workflows/build-sda-website.yml/runs?event=push&head_sha=${fixed.sourceCommit}&per_page=100`);
  need(runs.total_count <= 100, 'Run listing exceeds finite page bound');
  const candidates = runs.workflow_runs.filter(run => run.head_sha === fixed.sourceCommit && run.head_branch === fixed.branch && run.event === 'push');
  need(candidates.length === 1, 'Unique exact push run required');
  const run = api(`repos/${repository}/actions/runs/${number(candidates[0].id)}`);
  const list = api(`repos/${repository}/actions/runs/${run.id}/artifacts?per_page=100`); need(list.total_count === 2, 'Exact artifact list required');
  const observedAtUtc = new Date().toISOString(), rows = observedArtifacts(run, list.artifacts, fixed, Date.parse(observedAtUtc));
  fs.mkdirSync(out, { recursive: true });
  rows.forEach((row, index) => {
    const bytes = exec('gh', ['api', `repos/${repository}/actions/artifacts/${row.id}/zip`], root, { maxBuffer: index ? evidenceCap : cap });
    need(bytes.length <= (index ? evidenceCap : cap) && 'sha256:' + sha(bytes) === row.digest, 'Downloaded outer artifact digest differs');
    const archive = path.join(out, index ? 'evidence-artifact.zip' : 'bundle-artifact.zip'); fs.writeFileSync(archive, bytes, { flag: 'wx' });
    unpack(archive, path.join(out, index ? 'evidence' : 'payload'), index ? ['producer-evidence.json'] : ['package.json', 'website.zip'], index ? evidenceCap : cap);
  });
  const evidenceBytes = fs.readFileSync(path.join(out, 'evidence/producer-evidence.json')), evidence = JSON.parse(evidenceBytes);
  need(evidence.sourceCommit === fixed.sourceCommit && evidence.sourceTree === fixed.sourceTree && evidence.producerWorkflowPath === workflow
    && evidence.producerWorkflowSha256 === fixed.producerWorkflowSha256 && evidence.runId === run.id && evidence.runAttempt === 1
    && evidence.upload?.artifactId === rows[0].id && evidence.upload.name === rows[0].name && 'sha256:' + evidence.upload.archiveSha256 === rows[0].digest && evidence.upload.retentionDays === 7, 'Producer evidence/run/upload differs');
  need(evidence.repository === repository && evidence.protocolSha256 === protocol().sha256 && evidence.preBuildIgnoredInputs?.length === 0, 'Producer protocol/source facts differ');
  const p = protocol();
  const expectedInputs = sourceInputs(inputPaths(p));
  need(canonical(inventory(evidence.sourceInputs, true)) === canonical(expectedInputs), 'Observed source inventory differs from exact checked-out source');
  need(evidence.toolchain?.dotnet === '10.0.404' && evidence.toolchain.node === 'v22.9.0' && canonical(evidence.toolchain.actions) === canonical(actions), 'Observed pinned toolchain differs');
  for (const field of p.value.toolchainFields) need(typeof evidence.toolchain[field] === 'string' && evidence.toolchain[field].length > 0, 'Observed toolchain field missing');
  for (const state of [evidence.cleanState?.before, evidence.cleanState?.after]) need(state?.head === fixed.sourceCommit && state.tree === fixed.sourceTree && state.statusBase64 === '' && state.statusSha256 === sha(Buffer.alloc(0)), 'Observed raw clean evidence differs');
  const receiptBytes = fs.readFileSync(path.join(out, 'payload/package.json')), zip = fs.readFileSync(path.join(out, 'payload/website.zip'));
  const inner = verifyPackage(evidence, JSON.parse(receiptBytes), zip, protocol().runtime);
  need(canonical(inventory(inspectArchive(path.join(out, 'payload/website.zip'), inner))) === canonical(inner), 'Observed inner ZIP differs');
  return { outcome: 'candidate-producer-observation', observedAtUtc, fixed, run, artifacts: rows, producerEvidenceSha256: sha(evidenceBytes), zipSha256: sha(zip), packageReceiptSha256: sha(receiptBytes), sourceBuildAcceptance: null,
    limits: 'Read-only consistency observations; supplied facts are not independent source-build PASS, consumer acceptance, activation or deployment authority.' };
}
function argument(name) { const at = process.argv.indexOf(name); return at < 0 ? undefined : process.argv[at + 1]; }
function main() {
  const mode = argument('--mode'), output = argument('--output'); let result;
  if (mode === 'prepare') result = prepare();
  else if (mode === 'verify-build') result = verifyBuild(json(argument('--input')), argument('--payload'));
  else if (mode === 'record-upload') result = recordUpload(json(argument('--input')), process.env.SDA_UPLOAD_ID, process.env.SDA_UPLOAD_DIGEST);
  else if (mode === 'observe') result = observe(json(argument('--fixed')), argument('--directory'));
  else throw Error('Fixed producer mode required');
  write(output, result); console.log(JSON.stringify({ mode, output, sha256: sha(fs.readFileSync(outputPath(output))), limits: 'No independent acceptance awarded' }));
}
module.exports = { context, checkTools, cleanState, ignoredInputs, sourceInputs, controlInputs, inputPaths, outputPath, verifyPackage, recordUpload, artifactName, observedArtifacts, unpack, prepare, verifyBuild, observe, actions, workflow, root, repository, cap, evidenceCap };
if (require.main === module) main();
