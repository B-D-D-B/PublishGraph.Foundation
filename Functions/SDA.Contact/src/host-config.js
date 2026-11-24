'use strict';
const AUTHORIZED_HOSTS=Object.freeze(['sda.studio','www.sda.studio','silicondreamartists.com','www.silicondreamartists.com']);
function parseList(value,universe){
  if(value===undefined||value==='')return [];
  if(typeof value!=='string')return null;
  const entries=value.split(',');
  return entries.every(s=>universe.includes(s))&&new Set(entries).size===entries.length?entries:null;
}
function parseHostConfig(hostnames,origins){
  const hosts=parseList(hostnames,AUTHORIZED_HOSTS),allowed=parseList(origins,AUTHORIZED_HOSTS.map(h=>'https://'+h));
  if(!hosts||!allowed||hosts.length!==allowed.length||hosts.some(h=>!allowed.includes('https://'+h)))return {state:'invalid',challengeHostnames:[],origins:[]};
  return {state:hosts.length?'configured':'unconfigured',challengeHostnames:hosts,origins:allowed};
}
module.exports={AUTHORIZED_HOSTS,parseHostConfig};
