'use strict';
function jsonLiteral(source,start) {
  let depth=0,quoted=false,escaped=false;
  for(let end=start;end<source.length;end++) {
    const char=source[end];
    if(quoted){if(escaped)escaped=false;else if(char==='\\')escaped=true;else if(char==='"')quoted=false;continue;}
    if(char==='"'){quoted=true;continue;}
    if(char==='{' || char==='[')depth++;
    else if(char==='}' || char===']')depth--;
    if(depth===0){try{return JSON.parse(source.slice(start,end+1));}catch{return null;}}
  }return null;
}
module.exports={jsonLiteral};
