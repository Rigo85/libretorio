import {afterAll, beforeAll, describe, expect, test} from '@jest/globals';
import express from 'express';
import session from 'express-session';
import csrf from '@dr.pogodin/csurf';
import {hash, verify} from '@node-rs/argon2';
import {createServer, request, Server} from 'http';
import {AddressInfo} from 'net';
import {once} from 'events';
import {WebSocket, WebSocketServer} from 'ws';

describe('updated runtime dependencies',()=>{
 let server:Server, port:number, sockets:WebSocketServer;
 const store=new session.MemoryStore();
 function send(path:string, method='GET', headers:Record<string,string>={}){
  return new Promise<{status:number; cookie:string; body:string}>((resolve,reject)=>{
   const req=request({hostname:'127.0.0.1',port,path,method,headers},res=>{
    const chunks:Buffer[]=[];
    res.on('data',chunk=>chunks.push(chunk));res.on('error',reject);
    res.on('end',()=>resolve({status:res.statusCode!,cookie:res.headers['set-cookie']?.[0]?.split(';')[0]??'',body:Buffer.concat(chunks).toString()}));
   });req.on('error',reject);req.end();
  });
 }
 beforeAll(async()=>{
  const app=express();
  // Isolated HTTP fixture; the production secure-cookie configuration is unchanged.
  app.use(session({secret:'dependency-regression-only',resave:false,saveUninitialized:false,store}));
  app.use(csrf());
  app.get('/token',(req,res)=>res.json({token:req.csrfToken()}));
  app.post('/mutation',(_req,res)=>res.sendStatus(204));
  app.use((err:{status?:number;code?:string},_req:express.Request,res:express.Response,_next:express.NextFunction)=>{
   res.status(err.status??500).json({code:err.code});
  });
  server=createServer(app);sockets=new WebSocketServer({server,maxPayload:1024*1024});
  sockets.on('connection',socket=>socket.on('message',(data,isBinary)=>socket.send(data,{binary:isBinary})));
  const listening=once(server,'listening');server.listen(0,'127.0.0.1');await listening;
  port=(server.address() as AddressInfo).port;
 });
 afterAll(async()=>{
  for(const client of sockets?.clients??[])client.terminate();
  if(sockets)await new Promise<void>(resolve=>sockets.close(()=>resolve()));
  if(server?.listening)await new Promise<void>((resolve,reject)=>server.close(err=>err?reject(err):resolve()));
  store.clear();
 });
 test('accepts a session-bound CSRF token in the frontend header',async()=>{
  const response=await send('/token');expect(response.status).toBe(200);
  const token=JSON.parse(response.body).token;
  expect((await send('/mutation','POST',{Cookie:response.cookie,'X-CSRF-Token':token})).status).toBe(204);
 });
 test('rejects missing, invalid and cross-session CSRF tokens',async()=>{
  const first=await send('/token'),second=await send('/token');
  for(const headers of [{Cookie:first.cookie},{Cookie:first.cookie,'X-CSRF-Token':'invalid'},
   {Cookie:second.cookie,'X-CSRF-Token':JSON.parse(first.body).token}]){
   const response=await send('/mutation','POST',headers);
   expect(response.status).toBe(403);expect(JSON.parse(response.body).code).toBe('EBADCSRFTOKEN');
  }
 });
 test('verifies Argon2 hashes with the real native binding',async()=>{
  const password='local dependency compatibility passphrase';
  const encoded=await hash(password);
  expect(encoded).toMatch(/^\$argon2/);
  expect(await verify(encoded,password)).toBe(true);
  expect(await verify(encoded,password+'wrong')).toBe(false);
 });
 test('exchanges text and binary messages through the real WebSocket transport',async()=>{
  const client=new WebSocket(`ws://127.0.0.1:${port}`);
  try{
   await once(client,'open');
   for(const payload of ['catalogue-request',Buffer.from([0,1,2,255])]){
    const message=once(client,'message');client.send(payload);
    const [data,isBinary]=await message;
    expect(data).toEqual(Buffer.from(payload));expect(isBinary).toBe(Buffer.isBuffer(payload));
   }
   const closed=once(client,'close');client.close(1000);expect((await closed)[0]).toBe(1000);
  }finally{client.terminate();}
 });
});
