'use strict';
const {app}=require('@azure/functions');
const {TableClient}=require('@azure/data-tables');
const {DefaultAzureCredential}=require('@azure/identity');
const {createHandler}=require('./handler');
const {verifyChallenge,reserve}=require('./dependencies');
const {createTitanSend}=require('./titan-smtp');
const {parseHostConfig}=require('./host-config');
const hostConfig=parseHostConfig(process.env.TURNSTILE_HOSTNAMES,process.env.ALLOWED_ORIGINS);
const config={enabled:process.env.MAIL_ENABLED==='true',from:process.env.MAIL_FROM,...hostConfig,challengeSecret:process.env.TURNSTILE_SECRET};
const send=createTitanSend({...config,user:process.env.SMTP_USER,password:process.env.SMTP_PASSWORD});
let table;
function getTable(){if(!process.env.TABLE_ENDPOINT)throw Error('storage_unconfigured');return table ||= new TableClient(process.env.TABLE_ENDPOINT,process.env.TABLE_NAME||'contactDaily',new DefaultAzureCredential(),{retryOptions:{maxRetries:0}});}
app.http('contact',{route:'contact',methods:['GET','POST','PUT','DELETE','PATCH','HEAD','OPTIONS'],authLevel:'anonymous',handler:createHandler(config,{verify:(token,expectedHostname)=>verifyChallenge(token,config,expectedHostname),reserve:()=>reserve(getTable()),send})});
