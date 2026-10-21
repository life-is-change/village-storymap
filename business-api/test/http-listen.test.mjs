import test from 'node:test';import assert from 'node:assert/strict';import {EventEmitter} from 'node:events';import {listenLoopback} from './fixtures/http-listen.mjs';
test('test listener skips an unavailable exclusive port without requesting elevated permission',async()=>{
 class Server extends EventEmitter{attempts=0;listen(port,host,done){this.attempts++;this.port=port;assert.equal(host,'127.0.0.1');queueMicrotask(()=>this.attempts===1?this.emit('error',Object.assign(Error(),{code:'EACCES'})):done());}address(){return {port:this.port};}}
 const server=new Server();assert.ok((await listenLoopback(server)).port>=30000);assert.equal(server.attempts,2);
});
