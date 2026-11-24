const assert = require('node:assert/strict');

function absolutePath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || /[?*#\\%]/.test(value) || value.includes('//') || value.split('/').some(p => p === '.' || p === '..') || /^\/api(?:\/|$)/i.test(value)) throw Error('Invalid explicit route path: ' + value);
  return value;
}
// Conservative deployment guard; request matching below remains case sensitive.
function equivalenceKey(value) {
  return absolutePath(value).toLowerCase().replace(/\/$/, '').replace(/\/index\.html$/, '') || '/';
}
function routeMap(config) {
  if (!config || Object.keys(config).length !== 1 || !Array.isArray(config.routes)) throw Error('Unsupported preview configuration');
  const seen = new Set(), map = new Map();
  for (const rule of config.routes) {
    if (!rule || Object.keys(rule).length !== 2 || !Object.hasOwn(rule, 'route') || !Object.hasOwn(rule, 'rewrite')) throw Error('Invalid explicit rewrite');
    absolutePath(rule.route); absolutePath(rule.rewrite);
    const key = equivalenceKey(rule.route);
    if (seen.has(key)) throw Error('Native-equivalent duplicate route: ' + rule.route);
    seen.add(key); map.set(rule.route, rule.rewrite.slice(1));
  }
  return map;
}
function expectedConfig(catalog) {
  const map = new Map();
  for (const page of catalog.routes) for (const spelling of [page.canonical, ...page.aliases]) {
    absolutePath(spelling);
    const folder = spelling.replace(/\/$/, ''), route = folder + '/index.html', rewrite = '/' + page.output;
    absolutePath(rewrite);
    if (map.has(route) && map.get(route) !== rewrite) throw Error('Conflicting catalog target: ' + route);
    map.set(route, rewrite);
  }
  const config = { routes: [...map].map(([route, rewrite]) => ({ route, rewrite })) };
  routeMap(config);
  return config;
}
function validateConfig(config, catalog, names) {
  const map = routeMap(config);
  for (const target of map.values()) if (!names.includes(target)) throw Error('Missing runtime rewrite target: ' + target);
  assert.deepEqual(config, expectedConfig(catalog), 'Config differs from accepted catalog contract');
  return map;
}
// Mirrors SWA CLI getIndexHtml: only extensionless requests get a default index.
function resolveRequest(requestPath, map) {
  if (map.has(requestPath)) return map.get(requestPath);
  if (requestPath.toLowerCase().endsWith('index.html') || requestPath.includes('.')) return undefined;
  return map.get(requestPath.endsWith('/') ? requestPath + 'index.html' : requestPath + '/index.html');
}
module.exports = { absolutePath, equivalenceKey, routeMap, expectedConfig, validateConfig, resolveRequest };
