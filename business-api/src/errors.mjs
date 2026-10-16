const STATUS={INVALID_INPUT:400,UNAUTHORIZED:401,NOT_FOUND:404,METHOD_NOT_ALLOWED:405,PROFILE_NOT_SYNCED:409,AUTH_UNAVAILABLE:503,DB_UNAVAILABLE:503,FILE_UNAVAILABLE:503,FILE_BUSY:503};
export function failure(code){const safe=Object.hasOwn(STATUS,code)?code:'DB_UNAVAILABLE';return Object.assign(new Error(safe),{code:safe,status:STATUS[safe]});}
export function safeFailure(error){return failure(Object.hasOwn(STATUS,error?.code)?error.code:'DB_UNAVAILABLE');}
