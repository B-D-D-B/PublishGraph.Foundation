/* Public configuration belongs on #sda-contact. No credentials belong here. */
(function(){
  'use strict';
  var form=document.getElementById('sda-contact');if(!form)return;
  var button=form.querySelector('[type="submit"]'),status=document.getElementById('contact-status'),widget=document.getElementById('contact-challenge');
  var fields={firstName:'akID[37][value]',lastName:'akID[38][value]',email:'akID[39][value]',message:'akID[41][value]'};
  var mapping={'63':'membership','66':'artist','64':'commission','65':'sda-frame','89':'collectors','90':'other'};
  var subjects=Array.from(form.querySelectorAll('input[type="checkbox"]')),token='',busy=false,widgetId;
  var uncertain='We could not confirm the result. Your inquiry may have been accepted; retrying may send a duplicate.';
  function configured(){try{var u=new URL(form.dataset.endpoint);return form.dataset.enabled==='true'&&!!form.dataset.sitekey&&(u.protocol==='https:'||(u.protocol==='http:'&&['127.0.0.1','localhost'].includes(u.hostname)&&['127.0.0.1','localhost'].includes(location.hostname)));}catch(e){return false;}}
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
      var response=await fetch(form.dataset.endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),signal:controller.signal,credentials:'omit',redirect:'error'});
      var result=await response.json();
      if(response.status===202&&result&&result.ok===true&&result.status==='accepted'&&typeof result.requestId==='string'&&result.requestId&&Object.keys(result).sort().join(',')==='ok,requestId,status'){
        form.reset();subjectValidity();say('Your inquiry was accepted for sending. Thank you.');
      }else if(result&&result.ok===false&&typeof result.code==='string'&&typeof result.message==='string'&&typeof result.requestId==='string'){
        showFieldFeedback(result);
      }else say(uncertain);
    }catch(e){say(uncertain);}finally{clearTimeout(timer);busy=false;form.removeAttribute('aria-busy');resetChallenge();}
  });
  if(!configured()){say('Online submission is not configured yet.');ready();return;}
  window.sdaContactChallengeReady=function(){widgetId=window.turnstile.render(widget,{sitekey:form.dataset.sitekey,action:'contact',callback:function(t){token=t;ready();},'expired-callback':resetChallenge,'error-callback':function(){token='';ready();say('Verification is unavailable. Please try again later.');}});};
  var script=document.createElement('script');script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?onload=sdaContactChallengeReady&render=explicit';script.async=true;script.defer=true;document.head.appendChild(script);
})();
