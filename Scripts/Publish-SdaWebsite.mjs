import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import contract from '../Static/SDA-Standalone/tools/swa-route-contract.cjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(repo, 'Static/SDA-Standalone');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function relativeName(name) {
  if (typeof name !== 'string' || !name || name.includes('\\') || path.posix.isAbsolute(name) || /^[A-Za-z]:/.test(name) || name.split('/').some(p => !p || p === '.' || p === '..')) throw Error('Invalid runtime path');
  return name;
}
function uniqueNames(names) {
  const seen = new Set();
  return names.map(name => {
    relativeName(name);
    const key = name.toLowerCase();
    if (seen.has(key)) throw Error('Duplicate runtime path: ' + name);
    seen.add(key);
    return name;
  });
}
function regularFile(root, name) {
  let current = root;
  for (const part of relativeName(name).split('/')) {
    current = path.join(current, part);
    if (fs.lstatSync(current).isSymbolicLink()) throw Error('Symlink runtime path: ' + name);
  }
  if (!fs.statSync(current).isFile()) throw Error('Not a runtime file: ' + name);
  return current;
}
function freshOutput(out) {
  if (fs.existsSync(out)) throw Error('Output already exists: ' + out);
  const rel = path.relative(path.join(repo, 'dist'), out);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw Error('Output must be a fresh child of dist');
  let parent = path.dirname(out);
  while (parent !== repo) {
    if (fs.existsSync(parent) && fs.lstatSync(parent).isSymbolicLink()) throw Error('Symlink output parent');
    parent = path.dirname(parent);
  }
}
export function selfTest() {
  let pass = 0;
  for (const name of ['../x', '/x', 'a\\b', 'C:/x', 'a/./b', 'a//b']) { assert.throws(() => relativeName(name)); pass++; }
  assert.throws(() => uniqueNames(['a.js', 'A.js'])); pass++;
  assert.equal(relativeName('index.php/contact.html'), 'index.php/contact.html'); pass++;
  assert.throws(() => freshOutput(source)); pass++;
  for (const routes of [
    [{route:'/x',rewrite:'/a.html'},{route:'/x',rewrite:'/a.html'}],
    [{route:'/x',rewrite:'/a.html'},{route:'/x/',rewrite:'/a.html'}],
    [{route:'/X',rewrite:'/a.html'},{route:'/x',rewrite:'/b.html'}],
    [{route:'/x/',rewrite:'/a.html'},{route:'/x/index.html',rewrite:'/a.html'}],
    [{route:'/',rewrite:'/a.html'},{route:'/index.html',rewrite:'/b.html'}]
  ]) { assert.throws(() => contract.routeMap({routes}), /duplicate/); pass++; }
  assert.equal(contract.routeMap({routes:[{route:'/x/index.html',rewrite:'/a.html'},{route:'/x/y/index.html',rewrite:'/b.html'}]}).size,2); pass++;
  return { pass, fail: 0 };
}
export function packageWebsite({ sourceRoot = source, out = path.join(repo, 'dist/website') } = {}) {
  freshOutput(out);
  const manifest = JSON.parse(fs.readFileSync(path.join(sourceRoot, 'coverage-manifest.json')));
  if (manifest.pages.length !== 42 || manifest.assets.length !== 407) throw Error('Runtime manifest counts changed');
  const names = uniqueNames([...manifest.pages, ...manifest.assets].map(x => x.output).concat(['assets/static-preview.js', 'assets/contact.js', 'staticwebapp.config.json'])).sort();
  const files = names.map(name => {
    const bytes = fs.readFileSync(regularFile(sourceRoot, name));
    if (/contact@sda\.studio|mailto:[^"'<>\s]+@/i.test(bytes.toString('utf8'))) throw Error('Public recipient/fallback in ' + name);
    return { name, bytes, sha256: sha(bytes) };
  });
  const config = JSON.parse(files.find(x => x.name === 'staticwebapp.config.json').bytes);
  contract.validateConfig(config, JSON.parse(fs.readFileSync(path.join(sourceRoot, 'pretty-routes.json'))), names);
  fs.mkdirSync(out, { recursive: true });
  for (const file of files) {
    const target = path.join(out, file.name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, file.bytes, { flag: 'wx' });
    if (sha(fs.readFileSync(target)) !== file.sha256) throw Error('Copy verification failed: ' + file.name);
  }
  return { artifactRoot: out, count: files.length, bytes: files.reduce((n, x) => n + x.bytes.length, 0), publicRecipientMatches: 0, files: files.map(({ name, bytes, sha256 }) => ({ path: name, bytes: bytes.length, sha256 })) };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--self-test')) console.log(JSON.stringify(selfTest()));
  else {
    const args = process.argv.slice(2);
    if (args.length && (args.length !== 2 || args[0] !== '--out')) throw Error('Usage: node Scripts/Publish-SdaWebsite.mjs [--out dist/fresh-name]');
    console.log(JSON.stringify(packageWebsite({out:path.resolve(repo,args[1] || 'dist/website')}),null,2));
  }
}
