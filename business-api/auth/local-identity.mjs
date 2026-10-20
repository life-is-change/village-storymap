import {fault} from '../unified/contracts.mjs';

// Synthetic email is the historical account identifier, not a remote request.
export function localProfileFromUser(user,userId){
 const meta=user?.user_metadata;
 if(user?.id!==userId||user.is_anonymous===true||!user.email_confirmed_at||typeof meta!=='object'||meta===null||
    typeof meta.student_id!=='string'||!/^[a-z0-9_-]{2,32}$/.test(meta.student_id)||
    user.email!=='sid-'+meta.student_id+'@rzmbmwauomzwiyenafha.supabase.co'||
    typeof meta.display_name!=='string'||meta.display_name.length<1||meta.display_name.length>20)throw fault('PROFILE_NOT_SYNCED');
 const profile={id:userId,student_id:meta.student_id,display_name:meta.display_name};
 for(const [key,limit] of [['gender',12],['class_name',30],['grade',20]]){
  const value=meta[key]??'';if(typeof value!=='string'||value.length>limit)throw fault('PROFILE_NOT_SYNCED');profile[key]=value;
 }
 return profile;
}
