'use strict';
const isEmail = require('validator/lib/isEmail');
const labels = Object.freeze({membership:'Membership Inquiry',artist:'Artist Inquiry',commission:'Commission Inquiry','sda-frame':'SDA-Frame Inquiry',collectors:'Collectors Inquiry',other:'Other'});
const keys = ['firstName','lastName','email','subjects','message','challengeToken'];
const size = s => [...s].length;
function validate(value) {
  const fields = {};
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k=>!keys.includes(k))) return {fields, valid:false};
  for (const k of ['firstName','lastName']) {
    if(typeof value[k] !== 'string' || !value[k].trim() || size(value[k].trim())>100 || /[\x00-\x1f\x7f-\x9f]/u.test(value[k])) fields[k]='Enter a name of 1–100 characters without control characters.';
  }
  if(typeof value.email!=='string' || /[\x00-\x1f\x7f-\x9f]/u.test(value.email) || size(value.email.trim())>254 || !/^[\x21-\x7e]+$/.test(value.email.trim()) || !isEmail(value.email.trim(),{allow_utf8_local_part:false,allow_display_name:false,require_tld:true})) fields.email='Enter one valid email address.';
  if(!Array.isArray(value.subjects)||value.subjects.length<1||value.subjects.length>6||new Set(value.subjects).size!==value.subjects.length||value.subjects.some(s=>typeof s!=='string'||!Object.hasOwn(labels,s))) fields.subjects='Select one or more listed subjects.';
  if(typeof value.message!=='string'||!value.message.trim()||size(value.message.trim())>5000||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/u.test(value.message)) fields.message='Enter a message of 1–5,000 characters without unsupported controls.';
  if(typeof value.challengeToken!=='string'||!value.challengeToken.trim()||size(value.challengeToken)>2048) fields.challengeToken='Complete the verification challenge.';
  if(Object.keys(fields).length) return {valid:false,fields};
  return {valid:true,data:{...value,...Object.fromEntries(['firstName','lastName','email','message'].map(k=>[k,value[k].trim()]))}};
}
function message(data, from) {return {from,to:['contact@sda.studio'],replyTo:data.email,subject:'SDA website contact inquiry',text:`First name: ${data.firstName}\nLast name: ${data.lastName}\nEmail: ${data.email}\nSubjects: ${Object.keys(labels).filter(k=>data.subjects.includes(k)).map(k=>labels[k]).join(', ')}\n\nMessage:\n${data.message}`};}
module.exports={validate,message,labels};
