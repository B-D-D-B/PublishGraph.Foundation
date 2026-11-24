'use strict';
const cp = require('node:child_process'), net = require('node:net');
const { fs, path, project, root, contract, sha, argument, writeNew, bind } = require('./common.cjs');
async function startHost() {
  const socket = net.createServer();
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  const origin = 'http://127.0.0.1:' + port;
  const packageRoot = argument('--package-root');
  const dll = packageRoot ? path.resolve(packageRoot, 'SDA.Website.dll') : path.join(project, 'bin/Release/net10.0/SDA.Website.dll');
  if (!fs.existsSync(dll)) throw Error('Build Release host first');
  const environment = { ...process.env, ASPNETCORE_ENVIRONMENT: 'Production' };
  if (packageRoot) delete environment.SDA_CONTENT_ROOT;
  else environment.SDA_CONTENT_ROOT = path.join(root, 'SDA-Standalone');
  const child = cp.spawn('dotnet', [dll, '--urls', origin], { env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stdout.on('data', b => { output += b; }); child.stderr.on('data', b => { output += b; });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw Error('Host exited: ' + output);
    try { const response = await fetch(origin, { signal: AbortSignal.timeout(300) }); if (response.ok) return { origin, child, output: () => output }; } catch { }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  child.kill(); throw Error('Host startup deadline: ' + output);
}
async function run() {
  const run = argument('--run'); if (!run || fs.existsSync(run)) throw Error('--run requires fresh directory');
  fs.mkdirSync(run, { recursive: true }); bind(path.join(root, 'SDA-Standalone'));
  let host, rows = [];
  const assert = (name, pass, detail) => rows.push({ name, pass: !!pass, ...(pass ? {} : { detail }) });
  try {
    host = await startHost();
    const cases = [...contract.files.map(f => ({ path: '/' + f.path, file: f.path, status: f.path === 'staticwebapp.config.json' ? 404 : 200 })), ...Object.entries(contract.routes).map(([route, file]) => ({ path: route, file, status: 200 }))];
    for (const test of cases) {
      const file = contract.files.find(f => f.path === test.file), error = contract.errors.find(e => e.status === test.status);
      for (const method of ['GET', 'HEAD']) {
        const response = await fetch(host.origin + test.path, { method, redirect: 'manual' }), body = Buffer.from(await response.arrayBuffer());
        const expectedSha = test.status === 200 ? file.sha256 : sha(Buffer.from(error.bodyBase64, 'base64'));
        assert(method + ':' + test.path, response.status === test.status && (method === 'HEAD' ? body.length === 0 : sha(body) === expectedSha), { status: response.status, sha256: sha(body) });
        const headers = test.status === 200 ? file.headers : error.headers;
        assert('headers:' + method + ':' + test.path, Object.entries(headers).every(([key, value]) => response.headers.get(key) === value), Object.fromEntries(response.headers));
      }
    }
    for (const target of ['/unknown-resource', '/assets/absent.js', '/Program.cs', '/content-contract.json', '/tools/common.cjs', '/.auth/me']) {
      const r = await fetch(host.origin + target), b = Buffer.from(await r.arrayBuffer());
      assert('hidden:' + target, r.status === 404 && sha(b) === sha(Buffer.from(contract.errors.find(e => e.status === 404).bodyBase64, 'base64')), { status: r.status });
    }
    for (const target of ['/api/contact', '/api/unknown']) for (const method of ['GET', 'HEAD', 'POST', 'OPTIONS']) {
      const r = await fetch(host.origin + target, { method }), b = Buffer.from(await r.arrayBuffer());
      assert('disabled:' + method + ':' + target, r.status === 403 && (method === 'HEAD' ? b.length === 0 : sha(b) === sha(Buffer.from(contract.errors.find(e => e.status === 403).bodyBase64, 'base64'))), { status: r.status });
    }
    for (const target of ['/ART', '/index.php/ART.html', '/%zz', '/%5cProgram.cs', '/%252e%252e/Program.cs', '/%2e%2e%2fProgram.cs']) {
      const r = await fetch(host.origin + target), b = await r.text();
      assert('reject:' + target, [400, 403, 404].includes(r.status) && !b.includes('WebApplication.CreateBuilder'), { status: r.status });
    }
    const query = await fetch(host.origin + '/art?preserved=value');
    assert('query-clean-route', query.ok && sha(Buffer.from(await query.arrayBuffer())) === contract.files.find(f => f.path === contract.routes['/art']).sha256);
    assert('no-mail-backend-or-proxy', !/HttpClient|SmtpClient|Turnstile|MAIL_ENABLED/.test(fs.readFileSync(path.join(project, 'Program.cs'), 'utf8')));
  } catch (error) { rows.push({ name: 'execution', pass: false, detail: error.stack }); }
  finally { if (host) { host.child.kill(); fs.writeFileSync(path.join(run, 'host.txt'), host.output(), { flag: 'wx' }); } }
  const result = { capturedUtc: new Date().toISOString(), packageRoot: argument('--package-root') || null, startup: 'dotnet SDA.Website.dll; no apphost or source-content override for --package-root', contractSha256: sha(fs.readFileSync(path.join(project, 'content-contract.json'))), counts: { pass: rows.filter(r => r.pass).length, fail: rows.filter(r => !r.pass).length, total: rows.length }, rows };
  writeNew(path.join(run, 'result.json'), result); console.log(JSON.stringify({ counts: result.counts, failures: rows.filter(r => !r.pass) }));
  if (result.counts.fail) process.exitCode = 1;
}
module.exports = { startHost };
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
