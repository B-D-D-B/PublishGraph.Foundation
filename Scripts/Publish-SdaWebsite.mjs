import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

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
if (process.argv.includes('--self-test')) {
  let pass = 0;
  for (const name of ['../x', '/x', 'a\\b', 'C:/x', 'a/./b', 'a//b']) { assert.throws(() => relativeName(name)); pass++; }
  assert.throws(() => uniqueNames(['a.js', 'A.js'])); pass++;
  assert.equal(relativeName('index.php/contact.html'), 'index.php/contact.html'); pass++;
  assert.throws(() => freshOutput(source)); pass++;
  console.log(JSON.stringify({ pass, fail: 0 }));
} else {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--out')) throw Error('Usage: node Scripts/Publish-SdaWebsite.mjs [--out dist/fresh-name]');
  const out = path.resolve(repo, args[1] || 'dist/website');
  freshOutput(out);
  const manifest = JSON.parse(fs.readFileSync(path.join(source, 'coverage-manifest.json')));
  if (manifest.pages.length !== 42 || manifest.assets.length !== 384) throw Error('Runtime manifest counts changed');
  const names = uniqueNames([...manifest.pages, ...manifest.assets].map(x => x.output).concat(['assets/static-preview.js', 'assets/contact.js', 'staticwebapp.config.json'])).sort();
  const files = names.map(name => {
    const bytes = fs.readFileSync(regularFile(source, name));
    if (/contact@sda\.studio|mailto:[^"'<>\s]+@/i.test(bytes.toString('utf8'))) throw Error('Public recipient/fallback in ' + name);
    return { name, bytes, sha256: sha(bytes) };
  });
  const config = JSON.parse(files.find(x => x.name === 'staticwebapp.config.json').bytes);
  for (const route of config.routes) if (!names.includes(relativeName(route.rewrite.replace(/^\//, '')))) throw Error('Missing rewrite target');
  fs.mkdirSync(out, { recursive: true });
  for (const file of files) {
    const target = path.join(out, file.name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, file.bytes, { flag: 'wx' });
    if (sha(fs.readFileSync(target)) !== file.sha256) throw Error('Copy verification failed: ' + file.name);
  }
  console.log(JSON.stringify({ artifactRoot: out, count: files.length, bytes: files.reduce((n, x) => n + x.bytes.length, 0), publicRecipientMatches: 0, files: files.map(({ name, bytes, sha256 }) => ({ path: name, bytes: bytes.length, sha256 })) }, null, 2));
}
