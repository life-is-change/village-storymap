import {parseOperation,fault} from './contracts.mjs';
export function createPlanningService({database}){
 return {async execute(identity,action,input){
  if(!action.startsWith('planning.')&&!action.startsWith('personal.'))throw fault('NOT_FOUND');const parsed=parseOperation(action,input);
  return database.withIdentity(identity,async c=>(await c.query(parsed.readOnly?'SELECT api_private.planning_read($1,$2::jsonb) AS data':'SELECT api_private.planning_write($1,$2::jsonb) AS data',[action,JSON.stringify(parsed.input)])).rows[0]?.data,{readOnly:parsed.readOnly});
 }};
}
