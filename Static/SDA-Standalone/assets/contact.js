/* Public configuration belongs on #sda-contact. No credentials belong here. */
(function(){
  'use strict';
  var form=document.getElementById('sda-contact');if(!form)return;
  var button=form.querySelector('[type="submit"]'),status=document.getElementById('contact-status'),widget=document.getElementById('contact-challenge');
  var fields={firstName:'akID[37][value]',lastName:'akID[38][value]',email:'akID[39][value]',message:'akID[41][value]'};
  var mapping={'63':'membership','66':'artist','64':'commission','65':'sda-frame','89':'collectors','90':'other'};
  var subjects=Array.from(form.querySelectorAll('input[type="checkbox"]')),token='',busy=false,widgetId;
  var uncertain='We could not confirm the result. Your inquiry may have been accepted; retrying may send a duplicate.';
  var authorizedHosts=['sda.studio','www.sda.studio','silicondreamartists.com','www.silicondreamartists.com'];
  var binding=JSON.stringify([form.dataset.enabled,form.dataset.endpoint,form.dataset.sitekey,form.dataset.activeHosts]);
  function activeHost(){var raw=form.dataset.activeHosts;if(typeof raw!=='string'||!raw)return false;var hosts=raw.split(',');return hosts.every(function(h){return authorizedHosts.includes(h);})&&new Set(hosts).size===hosts.length&&hosts.includes(location.hostname)&&location.protocol==='https:'&&!location.port;}
  function endpoint(){try{if(form.dataset.endpoint!=='/api/contact')return null;var u=new URL(form.dataset.endpoint,location.origin);return activeHost()&&u.origin===location.origin&&u.pathname==='/api/contact'&&!u.username&&!u.password&&!u.search&&!u.hash?u.href:null;}catch(e){return null;}}
  function configured(){return binding===JSON.stringify([form.dataset.enabled,form.dataset.endpoint,form.dataset.sitekey,form.dataset.activeHosts])&&form.dataset.enabled==='true'&&typeof form.dataset.sitekey==='string'&&!!form.dataset.sitekey.trim()&&!!endpoint();}
  function ready(){button.disabled=busy||!configured()||!token;}
  var fieldLabels={firstName:'First name',lastName:'Last name',email:'Email address',subjects:'Subjects',message:'Message',challengeToken:'Verification challenge'},fieldFeedback=false;
  function say(text){status.textContent=text;fieldFeedback=false;}
  function clearFieldFeedback(){if(fieldFeedback)say('');}
  form.addEventListener('input',clearFieldFeedback);form.addEventListener('change',clearFieldFeedback);
  function showFieldFeedback(result){
    var names=result.fields&&typeof result.fields==='object'?Object.keys(result.fields).filter(function(k){return Object.prototype.hasOwnProperty.call(fieldLabels,k)&&typeof result.fields[k]==='string';}):[];
    say([result.code==='temporarily_unavailable'?'Contact submission is temporarily unavailable. Please try again later.':result.message].concat(names.map(function(k){return fieldLabels[k]+': '+result.fields[k];})).join('\n'));
    fieldFeedback=names.length>0;
    var first=names[0],control=first==='subjects'?subjects[0]:first==='challengeToken'?widget:first?form.elements.namedItem(fields[first]):null;if(control)control.focus();
  }
  function resetChallenge(){token='';if(window.turnstile&&widgetId!==undefined)window.turnstile.reset(widgetId);ready();}
  function subjectValidity(){subjects[0].setCustomValidity(subjects.some(function(s){return s.checked;})?'':'Select one or more subjects.');}
  subjects.forEach(function(s){s.addEventListener('change',subjectValidity);});subjectValidity();
  form.addEventListener('submit',async function(event){
    event.preventDefault();if(busy)return;subjectValidity();
    if(!form.reportValidity())return;
    if(!configured()||!token){say('Contact submission is unavailable. Please try again later.');return;}
    busy=true;form.setAttribute('aria-busy','true');ready();say('Submitting your inquiry…');
    var data={subjects:subjects.filter(function(s){return s.checked;}).map(function(s){return mapping[s.value];}),challengeToken:token};
    Object.keys(fields).forEach(function(k){data[k]=form.elements.namedItem(fields[k]).value;});
    var controller=new AbortController(),timer=setTimeout(function(){controller.abort();},30000);
    try {
      var response=await fetch(endpoint(),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),signal:controller.signal,credentials:'omit',redirect:'error'});
      var result=await response.json();
      if(response.status===202&&result&&result.ok===true&&result.status==='accepted'&&typeof result.requestId==='string'&&result.requestId&&Object.keys(result).sort().join(',')==='ok,requestId,status'){
        form.reset();subjectValidity();say('Your inquiry was accepted for sending. Thank you.');
      }else if(result&&result.ok===false&&typeof result.code==='string'&&typeof result.message==='string'&&typeof result.requestId==='string'){
        showFieldFeedback(result);
      }else say(uncertain);
    }catch(e){say(uncertain);}finally{clearTimeout(timer);busy=false;form.removeAttribute('aria-busy');resetChallenge();}
  });
  if(!configured()){say('Online submission is not configured yet.');ready();return;}
  window.sdaContactChallengeReady=function(){if(!configured()){token='';ready();return;}widgetId=window.turnstile.render(widget,{sitekey:form.dataset.sitekey,action:'contact',callback:function(t){token=configured()?t:'';ready();},'expired-callback':resetChallenge,'error-callback':function(){token='';ready();say('Verification is unavailable. Please try again later.');}});};
  var script=document.createElement('script');script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?onload=sdaContactChallengeReady&render=explicit';script.async=true;script.defer=true;document.head.appendChild(script);
})();
