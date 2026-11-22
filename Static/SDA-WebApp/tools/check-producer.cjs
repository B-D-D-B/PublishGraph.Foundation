'use strict';
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process'), assert = require('node:assert/strict');
const p = require('./producer.cjs'), { sha, canonical, inventory, inspectArchive } = require('./validate-artifact-protocol.cjs');
const output = process.argv[process.argv.indexOf('--output') + 1];
if (!output || !output.startsWith('artifacts/SDA-WEBAPP-PRODUCER-01/') || fs.existsSync(output)) throw Error('Fresh owned output required');
const work = path.resolve(path.dirname(output), path.basename(output, '.json') + '-fixtures');
if (fs.existsSync(work)) throw Error('Fresh fixture directory required');
fs.mkdirSync(work, { recursive: true });
const results = [];
function check(name, fn) { try { fn(); results.push({ name, pass: true }); } catch (error) { results.push({ name, pass: false, error: error.message }); } }
const fail = (name, fn) => check(name, () => assert.throws(fn));
const clone = value => JSON.parse(JSON.stringify(value));
const commit = '1'.repeat(40), tree = '2'.repeat(40), hash = 'a'.repeat(64);
const env = { GITHUB_REPOSITORY: p.repository, GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/agents/sda-website-migration-setup', GITHUB_SHA: commit,
  GITHUB_WORKFLOW_REF: p.repository + '/' + p.workflow + '@refs/heads/agents/sda-website-migration-setup', GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1' };
check('synthetic context exact push', () => assert.equal(p.context(env, commit).runId, 123));
for (const [field, value] of Object.entries({ GITHUB_REPOSITORY: 'other/repo', GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/other', GITHUB_SHA: '3'.repeat(40), GITHUB_WORKFLOW_REF: 'other', GITHUB_RUN_ID: '0', GITHUB_RUN_ATTEMPT: 'NaN' }))
  fail('reject synthetic context ' + field, () => p.context({ ...env, [field]: value }, commit));
const installation = path.join(work, 'sdk'); fs.mkdirSync(installation); const executable = path.join(installation, 'dotnet'); fs.writeFileSync(executable, 'synthetic executable path only');
const tools = { dotnet: '10.0.404', node: 'v22.9.0', pwsh: 'synthetic', git: 'synthetic', runnerOs: 'Linux', runnerArch: 'X64', runnerImage: 'synthetic', runnerImageVersion: 'synthetic' };
check('synthetic exact tools and isolated path', () => p.checkTools(tools, executable, installation));
for (const [field, value] of Object.entries({ dotnet: '10.0.999', node: 'v23.0.0', pwsh: '', git: '', runnerOs: '', runnerArch: '', runnerImage: '', runnerImageVersion: '' }))
  fail('reject tool field ' + field, () => p.checkTools({ ...tools, [field]: value }, executable, installation));
fail('reject SDK outside installation', () => p.checkTools(tools, __filename, installation));
const fixture = path.join(work, 'git'); fs.mkdirSync(fixture);
function git(args) { return cp.execFileSync('git', args, { cwd: fixture, encoding: 'utf8' }).trim(); }
git(['init', '--quiet']); fs.writeFileSync(path.join(fixture, '.gitattributes'), '* -text\n'); fs.writeFileSync(path.join(fixture, '.gitignore'), 'ignored/\n'); fs.writeFileSync(path.join(fixture, 'source.txt'), 'synthetic\n');
for (const file of p.controlInputs) fs.writeFileSync(path.join(fixture, file), 'synthetic build control\n');
git(['add', '.']); git(['-c', 'user.name=Synthetic fixture', '-c', 'user.email=synthetic@example.invalid', 'commit', '--quiet', '-m', 'Create synthetic guard fixture']);
check('actual tiny Git clean snapshot', () => assert.equal(p.cleanState(fixture).statusBase64, ''));
check('actual tiny Git empty ignored inventory', () => assert.deepEqual(p.ignoredInputs(fixture), []));
check('actual tiny Git indexed raw source bytes', () => assert.equal(p.sourceInputs(['source.txt'], fixture)[0].sha256, sha(Buffer.from('synthetic\n'))));
for (const file of ['global.json', 'Directory.Build.props', 'Directory.Packages.props', 'NuGet.Config']) {
  check('shared prepare/observe input inventory includes ' + file, () => assert.ok(p.inputPaths({ value: { requiredSourceInputs: [] }, runtime: { files: [] } }).includes(file)));
  check('synthetic indexed build control captured ' + file, () => assert.equal(p.sourceInputs([file], fixture)[0].sha256, sha(Buffer.from('synthetic build control\n'))));
  fs.unlinkSync(path.join(fixture, file));
  fail('reject missing build control ' + file, () => p.sourceInputs([file], fixture));
  fs.writeFileSync(path.join(fixture, file), 'changed build control\n');
  fail('reject changed build control ' + file, () => p.sourceInputs([file], fixture));
  fs.writeFileSync(path.join(fixture, file), 'synthetic build control\n');
}
fail('reject untracked required source', () => p.sourceInputs(['missing.txt'], fixture));
fs.writeFileSync(path.join(fixture, 'source.txt'), 'changed\n');
fail('reject raw tracked dirty status', () => p.cleanState(fixture));
fail('reject changed source/index bytes', () => p.sourceInputs(['source.txt'], fixture));
fs.writeFileSync(path.join(fixture, 'source.txt'), 'synthetic\n'); fs.writeFileSync(path.join(fixture, 'untracked.txt'), 'untracked');
fail('reject raw untracked status', () => p.cleanState(fixture)); fs.unlinkSync(path.join(fixture, 'untracked.txt'));
fs.mkdirSync(path.join(fixture, 'ignored')); fs.writeFileSync(path.join(fixture, 'ignored/cache'), 'cache');
fail('reject ignored prebuild cache', () => p.ignoredInputs(fixture));
const clean = { head: commit, tree, statusBase64: '', statusSha256: sha(Buffer.alloc(0)) };
const evidence = { version: 1, sourceCommit: commit, runId: 123, runAttempt: 1, cleanState: { before: clean, after: clean } };
check('synthetic native upload ID/digest creates facts only', () => {
  const value = p.recordUpload(evidence, '456', 'sha256:' + hash); assert.equal(value.upload.archiveSha256, hash); assert.equal(value.upload.retentionDays, 7);
  assert.equal(value.conclusion, undefined); assert.equal(value.disposition, undefined);
});
for (const id of ['', '0', '-1', 'not-id']) fail('reject upload id ' + JSON.stringify(id), () => p.recordUpload(evidence, id, hash));
for (const h of ['', 'sha256:bad', 'a'.repeat(40)]) fail('reject upload digest ' + JSON.stringify(h), () => p.recordUpload(evidence, 456, h));
fail('reject upload before verified build', () => p.recordUpload({ ...evidence, cleanState: { before: clean } }, 456, hash));
fail('reject producer self-completion', () => p.recordUpload({ ...evidence, conclusion: 'success' }, 456, hash));
fail('reject producer self-acceptance', () => p.recordUpload({ ...evidence, disposition: 'PASS' }, 456, hash));
fail('reject upload overwrite', () => p.recordUpload({ ...evidence, upload: {} }, 456, hash));
fail('reject oversized evidence', () => p.recordUpload({ ...evidence, padding: 'x'.repeat(p.evidenceCap) }, 456, hash));
// Deliberately synthetic ZIP bytes/receipt: tests receipt guards, never archive truth.
const runtime = JSON.parse(fs.readFileSync(path.join(p.root, 'Static/SDA-WebApp/content-contract.json')));
const protocol = JSON.parse(fs.readFileSync(path.join(__dirname, 'artifact-protocol.json')));
const zipBytes = Buffer.from('synthetic ZIP bytes; not a ZIP');
const hostFiles = ['Program.cs', 'SDA.Website.csproj', 'content-contract.json'].map(name => ({ path: name, sha256: sha(fs.readFileSync(path.join(p.root, 'Static/SDA-WebApp', name))) }));
const packageEvidence = { ...evidence, toolchain: tools, sourceInputs: hostFiles.map(row => ({ ...row, path: 'Static/SDA-WebApp/' + row.path })) };
const packageReceipt = { sourceCommit: commit, sourceDirty: false, dotnet: tools.dotnet, node: tools.node, startup: 'dotnet /home/site/wwwroot/SDA.Website.dll', package: { bytes: zipBytes.length, sha256: sha(zipBytes) }, hostFiles,
  content: { count: runtime.files.length, contractSha256: protocol.runtime.contractSha256, acceptedArtifactManifestSha256: protocol.runtime.acceptedArtifactManifestSha256, files: runtime.files },
  archive: inventory(runtime.files.map(row => ({ ...row, path: 'wwwroot/' + row.path }))) };
check('synthetic receipt shape pins actual452 contract', () => assert.equal(p.verifyPackage(packageEvidence, packageReceipt, zipBytes, runtime).length, 452));
for (const [field, value] of Object.entries({ sourceDirty: true, sourceCommit: tree, dotnet: 'wrong', node: 'wrong', startup: 'SDA.Website.exe' }))
  fail('reject synthetic package ' + field, () => p.verifyPackage(packageEvidence, { ...packageReceipt, [field]: value }, zipBytes, runtime));
fail('reject synthetic ZIP digest confusion', () => p.verifyPackage(packageEvidence, { ...packageReceipt, package: { bytes: zipBytes.length, sha256: hash } }, zipBytes, runtime));
fail('reject synthetic content count', () => { const receipt = clone(packageReceipt); receipt.content.count--; p.verifyPackage(packageEvidence, receipt, zipBytes, runtime); });
fail('reject synthetic missing archive content', () => { const receipt = clone(packageReceipt); receipt.archive.pop(); p.verifyPackage(packageEvidence, receipt, zipBytes, runtime); });
fail('reject synthetic host hash', () => { const receipt = clone(packageReceipt); receipt.hostFiles[0].sha256 = hash; p.verifyPackage(packageEvidence, receipt, zipBytes, runtime); });
fail('reject synthetic Windows apphost', () => { const receipt = clone(packageReceipt); receipt.archive.push({ path: 'SDA.Website.exe', bytes: 1, sha256: hash }); p.verifyPackage(packageEvidence, receipt, zipBytes, runtime); });
fail('reject synthetic tools leakage', () => { const receipt = clone(packageReceipt); receipt.archive.push({ path: 'tools/producer.cjs', bytes: 1, sha256: hash }); p.verifyPackage(packageEvidence, receipt, zipBytes, runtime); });
const fixed = { repository: p.repository, sourceCommit: commit, sourceTree: tree, producerWorkflowPath: p.workflow, producerWorkflowSha256: hash, branch: 'agents/sda-website-migration-setup' };
const run = { id: 123, run_attempt: 1, repository: { full_name: p.repository }, head_sha: commit, head_branch: fixed.branch, event: 'push', path: p.workflow, status: 'completed', conclusion: 'success' };
const now = Date.parse('2026-11-22T12:00:00Z');
const artifacts = [p.artifactName(evidence), p.artifactName(evidence) + '-evidence'].map((name, index) => ({ id: 456 + index, name, digest: 'sha256:' + hash, workflow_run: { id: 123, head_sha: commit }, expired: false, created_at: '2026-11-22T11:00:00Z', expires_at: '2026-11-29T11:00:00Z', size_in_bytes: 100 }));
check('synthetic completed run and exact two nonexpired artifacts', () => assert.equal(p.observedArtifacts(run, artifacts, fixed, now).length, 2));
for (const [field, value] of Object.entries({ run_attempt: 2, head_sha: tree, head_branch: 'other', event: 'workflow_dispatch', path: '.github/workflows/other.yml', status: 'in_progress', conclusion: 'failure' }))
  fail('reject observed run ' + field, () => p.observedArtifacts({ ...run, [field]: value }, artifacts, fixed, now));
fail('reject observed wrong repository', () => p.observedArtifacts({ ...run, repository: { full_name: 'other/repo' } }, artifacts, fixed, now));
for (const [field, value] of Object.entries({ id: 0, name: 'other', digest: 'sha256:bad', expired: true, created_at: '2026-11-23T12:00:00Z', expires_at: '2026-11-22T12:00:00Z', size_in_bytes: p.cap + 1 }))
  fail('reject artifact ' + field, () => { const rows = clone(artifacts); rows[0][field] = value; p.observedArtifacts(run, rows, fixed, now); });
fail('reject artifact wrong run', () => { const rows = clone(artifacts); rows[0].workflow_run.id = 999; p.observedArtifacts(run, rows, fixed, now); });
fail('reject artifact wrong source', () => { const rows = clone(artifacts); rows[0].workflow_run.head_sha = tree; p.observedArtifacts(run, rows, fixed, now); });
fail('reject missing evidence artifact', () => p.observedArtifacts(run, artifacts.slice(0, 1), fixed, now));
fail('reject duplicate artifact', () => p.observedArtifacts(run, [artifacts[0], artifacts[0]], fixed, now));
fail('reject oversized evidence download', () => { const rows = clone(artifacts); rows[1].size_in_bytes = p.evidenceCap + 1; p.observedArtifacts(run, rows, fixed, now); });
fail('reject outside output', () => p.outputPath('other/report.json'));
fail('reject output traversal', () => p.outputPath('artifacts/SDA-WEBAPP-PRODUCER-01/../escape.json'));
function sdkEnvironment(source) {
  const jobEnv = /^    env:\n((?:      .*\n)+)/m.exec(source);
  assert.ok(jobEnv, 'Static job environment required');
  assert.doesNotMatch(jobEnv[1], /\$\{\{[^\n]*\brunner\./, 'Runner context unavailable in job-level env');
  const steps = source.split(/^      - /m).slice(1).filter(step => /uses: actions\/setup-dotnet@|run: node Static\/SDA-WebApp\/tools\/(?:producer|package)\.cjs/.test(step));
  assert.equal(steps.length, 5, 'Expected install and four build/helper steps');
  for (const step of steps) {
    assert.match(step, /^        env:\n/m, 'SDK environment must be step-level');
    for (const field of ['DOTNET_INSTALL_DIR', 'DOTNET_ROOT'])
      assert.equal(step.split('          ' + field + ': ${{ runner.temp }}/sda-dotnet-10.0.404\n').length - 1, 1, 'Inconsistent isolated SDK path: ' + field);
  }
  return steps;
}
function workflowContract(source) {
  assert.match(source, /on:\n  push:\n    branches: \[main, agents\/sda-website-migration-setup\]/);
  assert.match(source, /permissions:\n  contents: read\n/); assert.match(source, /timeout-minutes: 25/);
  assert.match(source, /ref: \$\{\{ github.sha \}\}/); assert.match(source, /persist-credentials: false/);
  assert.match(source, /DOTNET_INSTALL_DIR: \$\{\{ runner.temp \}\}\/sda-dotnet-10.0.404/);
  sdkEnvironment(source);
  assert.match(source, /node-version: '22.9.0'/); assert.match(source, /dotnet-version: '10.0.404'/);
  for (const file of ['global.json', 'Directory.Build.props', 'Directory.Packages.props', 'NuGet.Config']) assert.ok(source.includes('      - ' + file + '\n'), 'Root control path trigger missing: ' + file);
  assert.equal((source.match(/retention-days: 7/g) || []).length, 2);
  for (const action of p.actions) assert.ok(source.includes(action.repository + '@' + action.commit));
  assert.doesNotMatch(source, /workflow_dispatch|pull_request|workflow_run:|schedule:|repository_dispatch|id-token:|environment:|secrets\.|azure\/|az login|az webapp|deploy-sda-website|cache:/i);
}
const workflowText = fs.readFileSync(path.join(p.root, p.workflow), 'utf8');
check('actual fixed push-only workflow static contract', () => workflowContract(workflowText));
check('F02 supported step-level SDK context and five consistent paths', () => assert.equal(sdkEnvironment(workflowText).length, 5));
fail('F02 reject runner context in job environment', () => sdkEnvironment(workflowText.replace('    env:\n', '    env:\n      DOTNET_ROOT: ${{ runner.temp }}/sda-dotnet-10.0.404\n')));
const priorFailedWorkflow = workflowText.replace(/^          DOTNET_INSTALL_DIR: .*\n/gm, '').replace(/^          DOTNET_ROOT: .*\n/gm, '').replace('    env:\n', '    env:\n      DOTNET_INSTALL_DIR: ${{ runner.temp }}/sda-dotnet-10.0.404\n      DOTNET_ROOT: ${{ runner.temp }}/sda-dotnet-10.0.404\n');
fail('F02 reject known failed job-level SDK layout', () => sdkEnvironment(priorFailedWorkflow));
sdkEnvironment(workflowText).forEach((step, index) => {
  fail('F02 reject missing isolated install path step ' + index, () => sdkEnvironment(workflowText.replace(step, step.replace(/^          DOTNET_INSTALL_DIR: .*\n/m, ''))));
  fail('F02 reject missing SDK root step ' + index, () => sdkEnvironment(workflowText.replace(step, step.replace(/^          DOTNET_ROOT: .*\n/m, ''))));
  fail('F02 reject inconsistent SDK root step ' + index, () => sdkEnvironment(workflowText.replace(step, step.replace('DOTNET_ROOT: ${{ runner.temp }}/sda-dotnet-10.0.404', 'DOTNET_ROOT: /wrong/sdk'))));
});
for (const file of ['global.json', 'Directory.Build.props', 'Directory.Packages.props', 'NuGet.Config'])
  fail('static reject missing root control trigger ' + file, () => workflowContract(workflowText.replace('      - ' + file + '\n', '')));
for (const marker of ['workflow_dispatch:', 'pull_request:', 'id-token: write', 'environment: prod', 'secrets.TOKEN', 'azure/login@bad', 'cache: npm'])
  fail('static reject ' + marker, () => workflowContract(workflowText + '\n' + marker));
const zip = path.join(work, 'tiny.zip');
const zipScript = `$ErrorActionPreference='Stop'; $r=[Console]::In.ReadToEnd()|ConvertFrom-Json; Add-Type -AssemblyName System.IO.Compression; $z=[IO.Compression.ZipFile]::Open($r.path,[IO.Compression.ZipArchiveMode]::Create); try{foreach($name in $r.names){$e=$z.CreateEntry($name); if($r.link){$e.ExternalAttributes=-1610612736};$s=$e.Open();try{$b=[Text.Encoding]::UTF8.GetBytes('fixture');$s.Write($b,0,$b.Length)}finally{$s.Dispose()}}}finally{$z.Dispose()}`;
function makeZip(file, names, link = false) { const r = cp.spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', zipScript], { input: JSON.stringify({ path: file, names, link }), encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); }
const expected = ['a.txt', 'b.txt'].map(name => ({ path: name, bytes: 7, sha256: sha(Buffer.from('fixture')) }));
check('actual tiny ZIP creation', () => makeZip(zip, expected.map(row => row.path)));
check('actual ZipFile reader positive byte/hash inventory', () => assert.equal(canonical(inventory(inspectArchive(zip, expected))), canonical(inventory(expected))));
fail('actual reader rejects wrong count', () => inspectArchive(zip, expected.slice(0, 1)));
fail('actual reader rejects wrong name', () => inspectArchive(zip, [{ ...expected[0], path: 'other.txt' }, expected[1]]));
fail('actual reader rejects wrong size', () => inspectArchive(zip, [{ ...expected[0], bytes: 8 }, expected[1]]));
fail('actual observed hash comparison rejects wrong hash', () => assert.equal(canonical(inventory(inspectArchive(zip, expected))), canonical(inventory([{ ...expected[0], sha256: hash }, expected[1]]))));
check('actual bounded two-leaf extraction', () => { const directory = path.join(work, 'unpacked'); p.unpack(zip, directory, ['a.txt', 'b.txt'], 14); assert.equal(fs.readFileSync(path.join(directory, 'a.txt'), 'utf8'), 'fixture'); });
fail('actual bounded extraction rejects size overflow', () => p.unpack(zip, path.join(work, 'overflow'), ['a.txt', 'b.txt'], 13));
const unsafe = path.join(work, 'unsafe.zip'); check('actual traversal ZIP fixture creation', () => makeZip(unsafe, ['../outside.txt']));
fail('actual bounded extraction refuses unexpected traversal name', () => p.unpack(unsafe, path.join(work, 'unsafe-out'), ['a.txt'], 100));
const linkZip = path.join(work, 'link.zip'); check('actual link ZIP fixture creation', () => makeZip(linkZip, ['a.txt'], true));
fail('actual reader rejects ZIP link', () => inspectArchive(linkZip, [expected[0]]));
fail('actual extractor rejects ZIP link', () => p.unpack(linkZip, path.join(work, 'link-out'), ['a.txt'], 100));
const failures = results.filter(row => !row.pass);
const report = { function: 'SDA-WEBAPP-PRODUCER-01', outcome: failures.length ? 'focused-checks-fail' : 'focused-checks-pass', passed: results.length - failures.length, failed: failures.length, total: results.length, results,
  limits: 'Synthetic context/tool/run/artifact fixtures and tiny actual Git/ZIP checks only. No actual producer run, service truth, independent acceptance, cloud or deployment effect.' };
fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' }); console.log(JSON.stringify({ output, passed: report.passed, failed: report.failed, total: report.total }));
if (failures.length) process.exitCode = 1;
