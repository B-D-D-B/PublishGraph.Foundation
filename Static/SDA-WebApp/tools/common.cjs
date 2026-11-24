'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const project = path.resolve(__dirname, '..'), root = path.resolve(project, '..');
const contract = JSON.parse(fs.readFileSync(path.join(project, 'content-contract.json')));
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function argument(name, fallback) { const at = process.argv.indexOf(name); return at < 0 ? fallback : process.argv[at + 1]; }
function writeNew(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' }); }
function bind(source) {
  const rows = contract.files.map(file => {
    const full = path.join(source, file.path);
    if (!fs.existsSync(full) || fs.lstatSync(full).isSymbolicLink()) throw Error('Missing or linked content: ' + file.path);
    const bytes = fs.readFileSync(full), actual = sha(bytes);
    if (actual !== file.sha256 || bytes.length !== file.bytes) throw Error('Content drift: ' + file.path);
    return { path: file.path, bytes: bytes.length, sha256: actual };
  });
  if (rows.length !== 452 || new Set(rows.map(row => row.path)).size !== rows.length) throw Error('Invalid accepted inventory');
  return { acceptedArtifactManifestSha256: contract.acceptedArtifactManifestSha256, contractSha256: sha(fs.readFileSync(path.join(project, 'content-contract.json'))), count: rows.length, files: rows };
}
module.exports = { fs, path, project, root, contract, sha, argument, writeNew, bind };
