'use strict';
function integer(env,key,fallback,min,max) {
 const value=env[key]==null?fallback:Number(env[key]);
 if(!Number.isSafeInteger(value)||value<min||value>max)throw Error('Invalid '+key);
 return value;
}
function aiRequestPolicy(model,env=process.env) {
 const supported=/^gpt-5(?:-mini|-nano)?(?:-\d{4}-\d{2}-\d{2})?$/.test(model);
 const reasoningEffort=supported?(env.OPENAI_REASONING_EFFORT || 'low'):null;
 if(reasoningEffort && !['minimal','low','medium','high'].includes(reasoningEffort))throw Error('Invalid OPENAI_REASONING_EFFORT');
 return {reasoningEffort,maxTransientRetries:integer(env,'OPENAI_MAX_TRANSIENT_RETRIES',1,0,5),requestTimeoutMs:integer(env,'OPENAI_REQUEST_TIMEOUT_MS',90000,1,1800000)};
}
module.exports={aiRequestPolicy};
