import {createBridgeHandler} from './core.mjs';
import {sourceAdapters} from './adapters.ts';
const instanceId=Deno.env.get('ALIYUN_BRIDGE_INSTANCE_ID')??'';
const adapters=sourceAdapters(instanceId);
Deno.serve(createBridgeHandler({instanceId,token:Deno.env.get('ALIYUN_BRIDGE_TOKEN')??'',...adapters}));
