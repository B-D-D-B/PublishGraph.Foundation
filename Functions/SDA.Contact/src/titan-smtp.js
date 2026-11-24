'use strict';
const tls=require('node:tls');
const nodemailer=require('nodemailer');
const isEmail=require('validator/lib/isEmail');
const SENDER='contact@bddb.io',RECIPIENT='contact@sda.studio',SUBJECT='SDA website contact inquiry';
const TLS_FAILURES=new Set(['DEPTH_ZERO_SELF_SIGNED_CERT','SELF_SIGNED_CERT_IN_CHAIN','UNABLE_TO_VERIFY_LEAF_SIGNATURE','UNABLE_TO_GET_ISSUER_CERT_LOCALLY','CERT_HAS_EXPIRED','ERR_TLS_CERT_ALTNAME_INVALID','CERT_NOT_YET_VALID']);
// The second argument is dependency injection for loopback tests, never environment configuration.
function createTitanSend(config,testing={}) {
  if(!config.enabled||config.from!==SENDER||config.user!==SENDER||typeof config.password!=='string'||!config.password.trim())return undefined;
  return async function send(message,signal) {
    if(signal?.aborted)throw Error('smtp_outcome_unknown');
    if(message.from!==SENDER||!Array.isArray(message.to)||message.to.length!==1||message.to[0]!==RECIPIENT||message.subject!==SUBJECT||typeof message.text!=='string'||typeof message.replyTo!=='string'||/[\x00-\x20\x7f-\x9f]/u.test(message.replyTo)||!isEmail(message.replyTo,{allow_utf8_local_part:false,allow_display_name:false,require_tld:true}))return 'refused';
    let socket,transport,finished=false,cleanSocketHook=()=>{};
    const stop=()=>{socket?.destroy();transport?.close();};
    const abort=()=>stop();
    signal?.addEventListener('abort',abort,{once:true});
    try {
      const options={host:'smtp.titan.email',port:465,secure:true,pool:false,logger:false,debug:false,transactionLog:false,forceAuth:true,
        auth:{user:config.user,pass:config.password},tls:{rejectUnauthorized:true,minVersion:'TLSv1.2',servername:'smtp.titan.email'},
        connectionTimeout:10000,greetingTimeout:10000,socketTimeout:10000,socketCloseTimeout:0,disableFileAccess:true,disableUrlAccess:true,
        getSocket(_options,done){
          if(finished||signal?.aborted)return done(Error('smtp_cancelled'));
          // Retain the TLS socket immediately, before asynchronous DNS/connect/handshake.
          socket=(testing.connect||tls.connect)({host:'smtp.titan.email',port:465,rejectUnauthorized:true,minVersion:'TLSv1.2',servername:'smtp.titan.email',...testing.socketOptions});
          let called=false;
          const complete=(err)=>{if(called)return;called=true;cleanSocketHook();if(finished||signal?.aborted){socket.destroy();return done(Error('smtp_cancelled'));}done(err,err?undefined:{connection:socket,secured:true});};
          const onError=err=>complete(err),onSecure=()=>complete();
          cleanSocketHook=()=>{socket.removeListener('error',onError);socket.removeListener('secureConnect',onSecure);};
          socket.once('error',onError);socket.once('secureConnect',onSecure);
          // Cancellation can race a synchronous injected connect implementation.
          if(signal?.aborted||finished)socket.destroy();
        }};
      transport=(testing.createTransport||nodemailer.createTransport)(options);
      if(signal?.aborted)throw Error('smtp_cancelled');
      const info=await transport.sendMail({from:{address:SENDER},to:[{address:RECIPIENT}],replyTo:{address:message.replyTo},subject:SUBJECT,text:message.text,envelope:{from:SENDER,to:[RECIPIENT]},disableFileAccess:true,disableUrlAccess:true,signal});
      if(signal?.aborted)throw Error('smtp_cancelled');
      return info.accepted?.length===1&&info.accepted[0]===RECIPIENT&&/^250(?:[ -]|$)/.test(info.response||'')?'accepted':'refused';
    }catch(error){
      if(!signal?.aborted&&(TLS_FAILURES.has(error.code)||Number.isInteger(error.responseCode)&&error.responseCode>=400&&error.responseCode<=599))return 'refused';
      throw Error('smtp_outcome_unknown');
    }finally{finished=true;signal?.removeEventListener('abort',abort);stop();cleanSocketHook();}
  };
}
module.exports={createTitanSend};
