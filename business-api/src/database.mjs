import pg from 'pg';
import {UUID} from './contracts.mjs';
import {failure,safeFailure} from './errors.mjs';
export function createDatabase(config){
 const pool=config.pool??new pg.Pool({...config,max:4,connectionTimeoutMillis:3000,idleTimeoutMillis:30000});
 pool.on?.('error',()=>{});
 return {
  async withIdentity(identity,fn){
   if(!UUID.test(identity?.userId??''))throw failure('UNAUTHORIZED');
   let client,discard;
   try{
    client=await pool.connect();
    await client.query('BEGIN READ ONLY');
    await client.query("SET LOCAL statement_timeout = '5s'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout = '10s'");
    await client.query("SELECT set_config('request.jwt.claims',$1,true),set_config('request.jwt.claim.sub',$2,true),set_config('request.jwt.claim.role','authenticated',true)",[JSON.stringify({sub:identity.userId,role:'authenticated',aud:'authenticated',iss:identity.issuer}),identity.userId]);
    await client.query('SET LOCAL ROLE authenticated');
    const result=await fn(client);
    await client.query('COMMIT');return result;
   }catch(error){
    if(client)try{await client.query('ROLLBACK');}catch{discard=new Error('DISCARD_CONNECTION');}
    throw safeFailure(error);
   }finally{client?.release(discard);}
  },
  close(){return pool.end();}
 };
}
