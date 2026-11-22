'use strict';
const cp = require('node:child_process');
const { fs, path, project, root, sha, argument, writeNew, bind } = require('./common.cjs');
const output = argument('--output'), receipt = argument('--receipt');
if (!output || !receipt) throw Error('--output and --receipt required');
const absolute = path.resolve(output), run = path.dirname(absolute), publish = path.join(run, 'publish');
if (fs.existsSync(absolute) || fs.existsSync(receipt) || fs.existsSync(publish)) throw Error('Refuse existing package outputs');
fs.mkdirSync(run, { recursive: true });
const source = path.join(root, 'SDA-Standalone'), content = bind(source);
const build = cp.spawnSync('dotnet', ['publish', path.join(project, 'SDA.Website.csproj'), '-c', 'Release', '-o', publish, '--nologo'], { encoding: 'utf8' });
fs.writeFileSync(path.join(run, 'publish.txt'), build.stdout + build.stderr, { flag: 'wx' });
if (build.status !== 0) throw Error('dotnet publish failed; inspect publish.txt');
const contentRoot = path.join(publish, 'wwwroot');
fs.mkdirSync(contentRoot, { recursive: false });
for (const file of content.files) {
  const target = path.join(contentRoot, file.path);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(source, file.path), target, fs.constants.COPYFILE_EXCL);
}
bind(contentRoot);
// Python/PowerShell ZIP differences are avoided with the installed .NET ZIP implementation.
// Relative entry names are normalized to forward slashes for the Linux App Service.
const zipScript = `Add-Type -AssemblyName System.IO.Compression; $z=[System.IO.Compression.ZipFile]::Open($env:SDA_PACKAGE_OUTPUT,[System.IO.Compression.ZipArchiveMode]::Create); try { Get-ChildItem -LiteralPath $env:SDA_PACKAGE_ROOT -Recurse -File | ForEach-Object { $name=[System.IO.Path]::GetRelativePath($env:SDA_PACKAGE_ROOT,$_.FullName).Replace('\\','/'); [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($z,$_.FullName,$name,[System.IO.Compression.CompressionLevel]::Optimal) | Out-Null } } finally { $z.Dispose() }`;
const zip = cp.spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', zipScript], { encoding: 'utf8', env: { ...process.env, SDA_PACKAGE_ROOT: publish, SDA_PACKAGE_OUTPUT: absolute } });
if (zip.status !== 0) throw Error('ZIP creation failed: ' + zip.stderr);
const inspectScript = `Add-Type -AssemblyName System.IO.Compression; $z=[System.IO.Compression.ZipFile]::OpenRead($env:SDA_PACKAGE_OUTPUT); try { $rows=@($z.Entries | ForEach-Object { $s=$_.Open(); try { [pscustomobject]@{ path=$_.FullName; bytes=$_.Length; sha256=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($s)).ToLowerInvariant() } } finally { $s.Dispose() } }); ConvertTo-Json -InputObject $rows -Depth 4 -Compress } finally { $z.Dispose() }`;
const inspection = cp.spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', inspectScript], { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024, env: { ...process.env, SDA_PACKAGE_OUTPUT: absolute } });
if (inspection.status !== 0) throw Error('ZIP inspection failed: ' + inspection.stderr);
const archive = JSON.parse(inspection.stdout);
for (const file of content.files) {
  const entry = archive.find(item => item.path === 'wwwroot/' + file.path);
  if (!entry || entry.sha256 !== file.sha256 || entry.bytes !== file.bytes) throw Error('ZIP content mismatch: ' + file.path);
}
if (archive.filter(item => item.path.startsWith('wwwroot/')).length !== content.count
    || archive.some(item => item.path.includes('\\') || item.path.split('/').includes('..') || /\.(exe|cs|csproj)$/.test(item.path) || item.path.startsWith('tools/')))
  throw Error('Nonportable or unexpected ZIP inventory');
const git = cp.execFileSync('git', ['rev-parse', 'HEAD'], { cwd: project, encoding: 'utf8' }).trim();
const hostFiles = ['Program.cs', 'SDA.Website.csproj', 'content-contract.json'].map(name => ({ path: name, sha256: sha(fs.readFileSync(path.join(project, name))) }));
writeNew(receipt, { sourceCommit: git, sourceDirty: cp.execFileSync('git', ['status', '--porcelain'], { cwd: project, encoding: 'utf8' }).trim().length > 0, dotnet: cp.execFileSync('dotnet', ['--version'], { encoding: 'utf8' }).trim(), node: process.version, startup: 'dotnet /home/site/wwwroot/SDA.Website.dll', package: { path: absolute, sha256: sha(fs.readFileSync(absolute)), bytes: fs.statSync(absolute).size }, hostFiles, content, archive });
console.log(JSON.stringify({ package: absolute, sha256: sha(fs.readFileSync(absolute)), count: content.count }));
