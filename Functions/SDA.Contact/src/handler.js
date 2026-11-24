'use strict';
const {randomUUID}=require('node:crypto');
const {validate,message}=require('./contract');
const {bounded}=require('./dependencies');
const texts={invalid_json:'Send valid JSON.',validation_failed:'Check the indicated fields.',origin_not_allowed:'This website origin is not allowed.',challenge_failed:'Complete a fresh verification challenge.',method_not_allowed:'Use POST.',request_too_large:'The request is too large.',unsupported_media_type:'Use uncompressed application/json.',daily_limit:'The daily contact limit has been reached. Please try tomorrow.',temporarily_unavailable:'Contact submission is temporarily unavailable. Please use the email link.',send_outcome_unknown:'We could not confirm the result. Your inquiry may have been accepted; retrying may send a duplicate.',unexpected_error:'An unexpected error occurred.'};
async function readBody(request) {
  const reader=request.body?.getReader();if(!reader)return '';
  const chunks=[];let bytes=0;
  try {while(true){const {value,done}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>16384){await reader.cancel();throw Object.assign(Error('large'),{status:413});}chunks.push(Buffer.from(value));}}finally{reader.releaseLock();}
  return new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));
}
function createHandler(config,deps) {return async function(request,context={}){
  const requestId=randomUUID(),started=Date.now(); let cors={};
  try {
    if(request.method==='OPTIONS'){
      const markers=request.query?.getAll('obs_run')||[];
      const markerPresent=markers.length===1&&markers[0].length===36&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(markers[0]);
      context.log?.(JSON.stringify({event:'contact.options.enter',invocationId:context.invocationId,requestId,markerPresent,...(markerPresent?{obs_run:markers[0]}:{})}));
    }
  }catch{}
  const respond=(status,code,extra={})=>{context.log?.(JSON.stringify({requestId,status,code,durationMs:Date.now()-started}));return {status,headers:{'Content-Type':'application/json','Cache-Control':'no-store',...cors},jsonBody:{ok:false,code,message:texts[code],requestId,...extra}};};
  try {
    const origin=request.headers.get('origin');
    if(!origin||origin==='null'||!config.origins.includes(origin))return respond(403,'origin_not_allowed');
    const expectedHostname=new URL(origin).hostname;
    cors={'Access-Control-Allow-Origin':origin,Vary:'Origin'};
    if(request.method==='OPTIONS'){
      const hs=request.headers.get('access-control-request-headers');
      if(request.headers.get('access-control-request-method')!=='POST'||(hs&&hs.split(',').some(h=>h.trim().toLowerCase()!=='content-type')))return respond(403,'origin_not_allowed');
      return {status:204,headers:{...cors,'Cache-Control':'no-store','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type'}};
    }
    if(request.method!=='POST'){const r=respond(405,'method_not_allowed');r.headers.Allow='POST, OPTIONS';return r;}
    if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('content-type')||'')||request.headers.has('content-encoding'))return respond(415,'unsupported_media_type');
    let data;try {data=JSON.parse(await readBody(request));}catch(e){return respond(e.status===413?413:400,e.status===413?'request_too_large':'invalid_json');}
    const v=validate(data);if(!v.valid)return respond(400,'validation_failed',{fields:v.fields});
    if(!config.enabled||!config.from||!deps.send)return respond(503,'temporarily_unavailable');
    let verified;try {verified=await deps.verify(v.data.challengeToken,expectedHostname);}catch{return respond(503,'temporarily_unavailable');}
    if(!verified)return respond(403,'challenge_failed');
    let reserved;try{reserved=await deps.reserve();}catch{return respond(503,'temporarily_unavailable');}
    if(!reserved){const r=respond(429,'daily_limit');const now=deps.now?.()||new Date();r.headers['Retry-After']=String(Math.ceil((Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()+1)-now)/1000));return r;}
    let outcome;try {outcome=await bounded(signal=>deps.send(message(v.data,config.from),signal),10000);}catch{return respond(504,'send_outcome_unknown');}
    if(outcome!=='accepted')return respond(503,'temporarily_unavailable');
    const r=respond(202,'accepted');r.jsonBody={ok:true,status:'accepted',requestId};return r;
  }catch{return respond(500,'unexpected_error');}
};}
module.exports={createHandler,readBody};
