'use strict';
// No production mock/bypass switch. Production mail adapter awaits owner selection.
async function bounded(work, ms) {
  const controller=new AbortController(); let timer;
  try {return await Promise.race([Promise.resolve().then(()=>work(controller.signal)),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('dependency_timeout'));},ms);})]);} finally {clearTimeout(timer);}
}
async function verifyChallenge(token, config, fetcher=fetch) {
  if(!config.challengeSecret||!config.challengeHostname) throw Error('challenge_unconfigured');
  return bounded(async signal=>{
    const r=await fetcher('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',signal,body:new URLSearchParams({secret:config.challengeSecret,response:token})});
    if(!r.ok) throw Error('challenge_unavailable');
    const data=await r.json();return data.success===true&&data.hostname===config.challengeHostname&&data.action==='contact';
  },5000);
}
async function reserve(client, now=new Date()) {
  return bounded(async signal=>{
    const rowKey=now.toISOString().slice(0,10), options={abortSignal:signal};
    for(let attempt=0;attempt<=3;attempt++) {
      try {
        let entity;
        try {entity=await client.getEntity('contact',rowKey,options);} catch(e){if(e.statusCode!==404)throw e;}
        if(!entity) {await client.createEntity({partitionKey:'contact',rowKey,count:1,date:rowKey},options);return true;}
        if(!Number.isInteger(entity.count)||entity.count<1||!entity.etag||entity.etag==='*')throw Error('invalid_counter');
        if(entity.count>=50)return false;
        await client.updateEntity({partitionKey:'contact',rowKey,count:entity.count+1,date:rowKey},'Replace',{...options,etag:entity.etag});return true;
      }catch(e){if(![409,412].includes(e.statusCode)||attempt===3)throw e;}
    }
    throw Error('reservation_failed');
  },5000);
}
module.exports={bounded,verifyChallenge,reserve};
