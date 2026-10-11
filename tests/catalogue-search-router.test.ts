import {afterEach,expect,jest,test} from '@jest/globals';
import {catalogueSearchRouter} from '../src/controllers/catalogueSearch';

const mockConnect=jest.fn<()=>Promise<any>>();
jest.mock('../src/db/PostgresAdapter',()=>({PostgresAdapter:{getInstance:()=>({pool:{connect:mockConnect}})}}));
const response=()=>{const res:any={destroyed:false,setHeader:jest.fn(),vary:jest.fn(),status:jest.fn(),json:jest.fn()};res.status.mockReturnValue(res);return res;};
const request=(user='reader',query:any={q:'Asimov'})=>({session:{userId:user},query});
const handler=(router:any)=>router.stack.find((layer:any)=>layer.route?.path==='/').route.stack[0].handle;
const client=()=>({release:jest.fn(),query:jest.fn<(...args:any[])=>Promise<any>>().mockResolvedValue({rows:[]})});
afterEach(()=>{mockConnect.mockReset();jest.useRealTimers();});

test('anonymous search is rejected before acquiring a database connection',()=>{
 const router:any=catalogueSearchRouter(),res=response();router.stack[0].handle({session:{}},res,jest.fn());
 expect(res.status).toHaveBeenCalledWith(401);expect(mockConnect).not.toHaveBeenCalled();
});
test('read-only query returns at most 50 cards and an opaque next cursor',async()=>{
 const db=client();db.query.mockImplementation(async(text:string)=>({rows:text.startsWith('WITH')?
  Array.from({length:51},(_,i)=>({id:i+1,key:'book'+i,title:'book'})):[]}));mockConnect.mockResolvedValue(db);
 const res=response();await handler(catalogueSearchRouter())(request(),res);
 const data=res.json.mock.calls[0][0];expect(data.items).toHaveLength(50);expect(data.next).toEqual(expect.any(String));
 expect(data.items[0].key).toBeUndefined();expect(db.query).toHaveBeenCalledWith('BEGIN READ ONLY');
 expect(db.query).toHaveBeenCalledWith(expect.stringContaining("work_mem='4MB'"));
 expect(db.release).toHaveBeenCalledTimes(1);
});
test('a statement timeout rolls back and never becomes an empty successful search',async()=>{
 const db=client();db.query.mockImplementation(async(text:string)=>{if(text.startsWith('WITH'))throw {code:'57014'};return {rows:[]};});
 mockConnect.mockResolvedValue(db);const res=response();await handler(catalogueSearchRouter())(request(),res);
 expect(res.status).toHaveBeenCalledWith(503);expect(res.json).toHaveBeenCalledWith({code:'SEARCH_TIMEOUT'});
 expect(db.query).toHaveBeenCalledWith('ROLLBACK');expect(db.release).toHaveBeenCalledTimes(1);
});
test('at most two searches acquire connections; one request per user',async()=>{
 const pending:Array<(value:any)=>void>=[];mockConnect.mockImplementation(()=>new Promise(resolve=>pending.push(resolve)));
 const run=handler(catalogueSearchRouter()),first=run(request('a'),response()),second=run(request('b'),response());
 for(const user of ['a','c']){const res=response();await run(request(user),res);expect(res.status).toHaveBeenCalledWith(429);}
 expect(mockConnect).toHaveBeenCalledTimes(2);pending.forEach(resolve=>resolve(client()));await Promise.all([first,second]);
});
test('timed-out pool acquisition retains its slot until the late connection is released',async()=>{
 jest.useFakeTimers();let resolve!:(value:any)=>void;mockConnect.mockImplementation(()=>new Promise(done=>resolve=done));
 const run=handler(catalogueSearchRouter()),res=response(),waiting=run(request(),res);
 await jest.advanceTimersByTimeAsync(1501);await waiting;expect(res.status).toHaveBeenCalledWith(503);
 const blocked=response();await run(request(),blocked);expect(blocked.status).toHaveBeenCalledWith(429);
 const late=client();resolve(late);await Promise.resolve();expect(late.release).toHaveBeenCalledTimes(1);expect(late.query).not.toHaveBeenCalled();
 mockConnect.mockResolvedValue(client());const retry=response();await run(request(),retry);expect(retry.json).toHaveBeenCalledWith(expect.objectContaining({items:[]}));
});
