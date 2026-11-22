'use strict';
const { fs, path, root, contract, sha, argument, writeNew, bind } = require('./common.cjs');
const source = path.resolve(argument('--source', path.join(root, 'SDA-Standalone')));
const external = argument('--manifest');
if (external && sha(fs.readFileSync(external)) !== contract.acceptedArtifactManifestSha256) throw Error('Accepted manifest identity mismatch');
const result = bind(source), output = argument('--output');
if (!output) throw Error('--output fresh receipt path is required');
writeNew(output, result);
console.log(JSON.stringify({ count: result.count, contractSha256: result.contractSha256 }));
