import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { packageWebsite, selfTest } from './Publish-SdaWebsite.mjs';
import contract from '../Static/SDA-Standalone/tools/swa-route-contract.cjs';
import serverModule from '../Static/SDA-Standalone/tools/serve.cjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.join(repo, 'Static/SDA-Standalone'), args = process.argv.slice(2);
const run = args[0] || 'focused', artifact = path.resolve(repo, args[1] || 'dist/website-swa-routes-08');
if (!/^[a-zA-Z0-9_-]+$/.test(run)) throw Error('Invalid run');
const dir = path.join(repo, 'dist/swa-routes-08', run);
if (fs.existsSync(dir)) throw Error('Existing immutable run');
fs.mkdirSync(dir);
const report = { environment: { node: process.version }, checks: [], limitations: ['Local checks do not establish native-client upload validation or Azure behavior.'], failures: [] };
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function test(name, ok, detail) { report.checks.push({name, pass:!!ok, ...(detail ? {detail} : {})}); }
const readJson = file => JSON.parse(fs.readFileSync(file));
const catalog = readJson(root + '/pretty-routes.json'), config = readJson(root + '/staticwebapp.config.json');
const coverage = readJson(root + '/coverage-manifest.json');
const names = [...coverage.pages, ...coverage.assets].map(x => x.output).concat(['assets/static-preview.js', 'assets/contact.js', 'staticwebapp.config.json']).sort();
const map = contract.validateConfig(config, catalog, names);
const require = createRequire(root + '/package.json');
let browser;
const servers = [];
async function listen(target, prefix='/') { const s = await serverModule.serve(target,prefix); servers.push(s); return 'http://127.0.0.1:' + s.address().port; }
async function raw(base, target) { return new Promise((resolve,reject) => {const u=new URL(base),req=http.request({hostname:u.hostname,port:u.port,path:target},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);req.end();}); }
try {
  test('selftest', selfTest().fail === 0);
  test('exact counts', catalog.routes.length === 42 && map.size === 43 && names.length === 429);
  // Packaging fixtures preserve the actual manifest/name contract but use tiny inert file bodies.
  const fixture = path.join(dir,'fixture'); fs.mkdirSync(fixture);
  for (const name of names) {fs.mkdirSync(path.dirname(path.join(fixture,name)),{recursive:true});fs.writeFileSync(path.join(fixture,name),'fixture');}
  fs.writeFileSync(fixture+'/coverage-manifest.json',JSON.stringify(coverage));
  fs.writeFileSync(fixture+'/pretty-routes.json',JSON.stringify(catalog));
  const variants = [
    ['exact duplicate',c=>c.routes.push({...c.routes[1]})],
    ['slash duplicate',c=>c.routes.push({route:'/about-sda/',rewrite:c.routes[1].rewrite})],
    ['folder duplicate',c=>c.routes.push({route:'/about-sda',rewrite:'/index.html'})],
    ['case duplicate',c=>c.routes.push({route:'/ABOUT-SDA/index.html',rewrite:c.routes[1].rewrite})],
    ['malformed traversal',c=>c.routes[1].route='/about-sda/../x'],
    ['wildcard',c=>c.routes[1].route='/about-sda*'],
    ['api route',c=>c.routes[1].route='/api/contact'],
    ['missing target',c=>c.routes[1].rewrite='/missing.html'],
    ['omitted destination',c=>c.routes.splice(1,1)],
    ['wrong existing target',c=>c.routes[1].rewrite='/index.html']
  ];
  for (const [label, mutate] of variants) {
    const c=structuredClone(config);mutate(c);fs.writeFileSync(fixture+'/staticwebapp.config.json',JSON.stringify(c));
    const out=path.join(dir,'rejected-'+label.replaceAll(' ','-')); let error;
    const child=spawnSync(process.execPath,['--input-type=module','-e',`import {packageWebsite} from './Scripts/Publish-SdaWebsite.mjs';packageWebsite(JSON.parse(process.argv[1]));`,JSON.stringify({sourceRoot:fixture,out})],{cwd:repo,encoding:'utf8'});
    error=child.stderr;
    test('packaging rejects '+label,child.status===1&&!!error&&!fs.existsSync(out),error);
  }
  fs.writeFileSync(fixture+'/staticwebapp.config.json',JSON.stringify(config));
  const valid=packageWebsite({sourceRoot:fixture,out:path.join(dir,'valid-fixture')});test('valid fixture packages',valid.count===429);
  // Independent official package matcher, loaded from its pinned installed implementation.
  const official=path.join(repo,'dist/swa-routes-08/official-cli/node_modules/@azure/static-web-apps-cli');
  const lock=readJson(path.join(repo,'dist/swa-routes-08/official-cli/package-lock.json'));
  const dependency=lock.packages['node_modules/@azure/static-web-apps-cli'];
  test('official CLI version/integrity',dependency.version==='2.1.0'&&dependency.integrity==='sha512-RUbHhLaGDQAbW0d0J3HzKIT3jumQtIaQF2g/qiTa1GeWO9/aasdn5k5WOWD+rpL+eUc+LjM1R/xbQpvbp7j3gg==');
  const matcherPath=official+'/dist/msha/routes-engine/route-processor.js';
  report.official={version:dependency.version,integrity:dependency.integrity,matcherSHA256:sha(fs.readFileSync(matcherPath)),indexHelperSHA256:sha(fs.readFileSync(official+'/dist/msha/routes-engine/rules/routes.js'))};
  const {doesRequestPathMatchRoute}=await import('file:///'+matcherPath.replaceAll('\\','/'));
  const accepted=catalog.routes.flatMap(page=>[page.canonical,...page.aliases].map(route=>({route,output:page.output})));
  const explicit=config.routes.map(r=>({route:r.route,output:r.rewrite.slice(1)}));
  for(const {route,output} of [...accepted,...explicit]) {
    const matches=config.routes.filter(r=>doesRequestPathMatchRoute(route,r,'GET',undefined,0));
    test('official match '+route,matches.length===1&&matches[0].rewrite==='/'+output);
  }
  const negatives=['/no-such-page','/about-sda/not-a-child','/SDA-Frame','/sdaframe/extra','/about-sda-extra','/about-sda/index.html/extra','/api/contact'];
  for(const route of negatives)test('official negative '+route,!config.routes.some(r=>doesRequestPathMatchRoute(route,r,'GET',undefined,0)));
  for(const [label,target] of [['source',root],['artifact',artifact]]) {
    const base=await listen(target);
    for(const {route,output} of [...accepted,...explicit,...coverage.pages.map(p=>({route:'/'+p.output,output:p.output}))])for(const query of ['', '?route-check=1']) {
      const res=await fetch(base+route+query,{redirect:'manual'}),body=Buffer.from(await res.arrayBuffer());
      test(label+' HTTP '+route+query,res.status===200&&!res.headers.has('location')&&body.equals(fs.readFileSync(path.join(root,output))));
    }
    for(const route of negatives)test(label+' 404 '+route,await raw(base,route)===404);
    for(const [route,status] of [['/%2e%2e/AGENTS.md',403],['/foo%5cbar',403],['/%ZZ',400]])test(label+' malformed '+route,await raw(base,route)===status);
    if(label==='source') {
      const {chromium}=require('playwright');browser=await chromium.launch({channel:'msedge'});report.environment.browser=browser.version();
      const context=await browser.newContext({serviceWorkers:'block'});await context.route('**/*',r=>r.request().url().startsWith(base)?r.continue():r.abort());
      const page=await context.newPage();
      for(const route of ['/','/about-sda','/about-sda/','/sdaframe/','/sda-frame','/art/projects/advanced-aether-adworks/']) {
        const url=base+route+'?keep=yes#main-content';await page.goto(url,{waitUntil:'domcontentloaded'});await page.reload({waitUntil:'domcontentloaded'});test('browser preserves '+route,page.url()===url);
      }
      await context.close();await browser.close();browser=undefined;
    }
  }
  const mounted=await listen(root,'/preview/');for(const {route} of accepted)test('mounted '+route,(await fetch(mounted+'/preview'+route,{redirect:'manual'})).status===200);
  const plain=path.join(dir,'plain');fs.mkdirSync(plain);fs.writeFileSync(plain+'/index.html','plain');fs.writeFileSync(plain+'/Exact.css','body{}');const plainBase=await listen(plain,'/preview/');
  for(const [route,status] of [['/preview/',200],['/preview/Exact.css',200],['/preview/exact.css',404],['/Exact.css',404],['/preview/missing',404],['/preview/%2e%2e/Exact.css',403]])test('no-config '+route,await raw(plainBase,route)===status);
  test('no-config MIME',(await fetch(plainBase+'/preview/Exact.css')).headers.get('content-type')==='text/css');
  const actual=[];function walk(dir,prefix=''){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const name=prefix+entry.name;if(entry.isDirectory())walk(path.join(dir,entry.name),name+'/');else actual.push(name);}}walk(artifact);
  test('artifact allowlist',JSON.stringify(actual.sort())===JSON.stringify(names));
  for(const name of actual){const bytes=fs.readFileSync(path.join(artifact,name));test('artifact source hash '+name,sha(bytes)===sha(fs.readFileSync(path.join(root,name))));test('artifact privacy '+name,!/contact@sda\.studio|mailto:[^"'<>\s]+@/i.test(bytes.toString()));}
  for(const page of coverage.pages){const s=fs.readFileSync(path.join(artifact,page.output),'utf8');if(page.output==='index.php/contact.html')test('accepted disabled same-origin endpoint',s.includes('data-endpoint="/api/contact"')&&s.includes('data-enabled="false"')&&s.includes('data-sitekey=""')&&/<button[^>]+disabled/.test(s));}
} catch(e) { report.failures.push({error:e.stack}); process.exitCode=1; }
finally {
  if(browser)await browser.close();for(const s of servers){s.closeAllConnections();await new Promise(r=>s.close(r));}
  report.counts={pass:report.checks.filter(x=>x.pass).length,fail:report.checks.filter(x=>!x.pass).length+report.failures.length,total:report.checks.length+report.failures.length};
  fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(report,null,2),{flag:'wx'});
  console.log(JSON.stringify({counts:report.counts,failures:report.checks.filter(x=>!x.pass),exceptions:report.failures,receipt:path.join(dir,'result.json')}));if(report.counts.fail)process.exitCode=1;
}
