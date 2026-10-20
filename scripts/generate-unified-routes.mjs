import {writeFileSync,readFileSync} from 'node:fs';
import {OPERATIONS} from '../business-api/unified/contracts.mjs';
const routes=Object.fromEntries(Object.entries(OPERATIONS).map(([name,value])=>[name,{method:value.method,path:value.path}]));
writeFileSync(new URL('../linux/unified-operation-routes.json',import.meta.url),JSON.stringify(routes,null,2)+'\n');
writeFileSync(new URL('../features/data/unified-operation-routes.js',import.meta.url),'// Generated from business-api/unified/contracts.mjs; parity is tested.\n(function(root){const ROUTES='+JSON.stringify(routes,null,2)+';for(const route of Object.values(ROUTES))Object.freeze(route);const api=Object.freeze({ROUTES:Object.freeze(ROUTES)});if(typeof module===\'object\'&&module.exports)module.exports=api;if(root)root.UnifiedOperationRoutesModule=api;})(typeof globalThis!==\'undefined\'?globalThis:this);\n');
const doc=new URL('../docs/migration/unified-business-operations.md',import.meta.url),text=readFileSync(doc,'utf8');
writeFileSync(doc,text.slice(0,text.indexOf('| 动作 |'))+'| 动作 | 路由 | 读/写 | 请求字段 | 源入口/数据/RPC | 当前证明 |\n| --- | --- | --- | --- | --- | --- |\n'+Object.entries(OPERATIONS).map(([name,v])=>`| \`${name}\` | \`${v.method} ${v.path}\` | ${v.readOnly?'读':'写'} | ${v.fields.join(', ')} | ${v.source.replaceAll('|','/')} | DTO: unified-contracts.test.mjs |`).join('\n')+'\n');
