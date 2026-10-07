'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const path=require('node:path');
test('loading merchant HTTP support does not disable certificate validation for API/database clients',()=>{
 const env={...process.env};delete env.NODE_TLS_REJECT_UNAUTHORIZED;
 const modulePath=path.resolve(__dirname,'../src/httpClient.js');
 const result=spawnSync(process.execPath,['-e',`require(${JSON.stringify(modulePath)}); if(process.env.NODE_TLS_REJECT_UNAUTHORIZED!==undefined) process.exit(1);`],{env,encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);
});
