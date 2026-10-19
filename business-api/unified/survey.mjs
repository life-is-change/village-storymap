import {parseOperation,fault} from './contracts.mjs';
export function createSurveyService({database,files,taskReferences}){
 return {
  async execute(identity,action,input){
   if(!action.startsWith('survey.'))throw fault('NOT_FOUND');const parsed=parseOperation(action,input);
   return database.withIdentity(identity,async c=>{
    if(action==='survey.deletePhoto'){
     if(!taskReferences?.assertPhotoMutable)throw fault('DB_UNAVAILABLE');
     await taskReferences.assertPhotoMutable(c,identity,input.photoId);
    }
    return (await c.query(parsed.readOnly?'SELECT api_private.survey_read($1,$2::jsonb) AS data':'SELECT api_private.survey_write($1,$2::jsonb) AS data',[action,JSON.stringify(parsed.input)])).rows[0]?.data;
   },{readOnly:parsed.readOnly});
  }
 };
}
