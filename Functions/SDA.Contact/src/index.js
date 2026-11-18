'use strict';
const {app}=require('@azure/functions');
const {TableClient}=require('@azure/data-tables');
const {DefaultAzureCredential}=require('@azure/identity');
const {createHandler}=require('./handler');
const {verifyChallenge,reserve}=require('./dependencies');
const development=process.env.AZURE_FUNCTIONS_ENVIRONMENT==='Development';
const origins=(process.env.ALLOWED_ORIGINS||'').split(',').map(s=>s.trim()).filter(s=>{try{const u=new URL(s);return u.origin===s&&!u.username&&!u.password&&(u.protocol==='https:'||development&&u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname))&&(development||!['localhost','127.0.0.1','[::1]'].includes(u.hostname));}catch{return false;}});
const config={enabled:process.env.MAIL_ENABLED==='true',from:process.env.MAIL_FROM,origins,challengeSecret:process.env.TURNSTILE_SECRET,challengeHostname:process.env.TURNSTILE_HOSTNAME};
// Missing provider selection deliberately keeps all production sends unavailable.
let table;
function getTable(){if(!process.env.TABLE_ENDPOINT)throw Error('storage_unconfigured');return table ||= new TableClient(process.env.TABLE_ENDPOINT,process.env.TABLE_NAME||'contactDaily',new DefaultAzureCredential(),{retryOptions:{maxRetries:0}});}
app.http('contact',{route:'contact',methods:['GET','POST','PUT','DELETE','PATCH','HEAD','OPTIONS'],authLevel:'anonymous',handler:createHandler(config,{verify:token=>verifyChallenge(token,config),reserve:()=>reserve(getTable())})});
