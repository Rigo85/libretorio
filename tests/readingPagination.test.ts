import {beforeEach, expect, jest, test} from '@jest/globals';
import {historyCursor} from '../src/controllers/reading';
import {ReadingRepository} from '../src/repositories/ReadingRepository';
const mockQuery=jest.fn<(...args:any[])=>Promise<any>>();
jest.mock('../src/db/PostgresAdapter',()=>({PostgresAdapter:{getInstance:()=>({pool:{query:mockQuery}})}}));
const cursor={at:'2026-10-07 12:34:56.123456+00',id:'00000000-0000-4000-8000-000000000001'};
const encoded=(value:any)=>Buffer.from(JSON.stringify(value)).toString('base64url');
beforeEach(()=>mockQuery.mockReset().mockResolvedValue({rows:[]}));
test('preserves microseconds and rejects malformed, duplicate and ambiguous cursors',()=>{
  expect(historyCursor(encoded(cursor),undefined)).toEqual(cursor);
  expect(historyCursor(undefined,encoded(cursor))).toEqual(cursor);
  expect(historyCursor(undefined,undefined)).toBeUndefined();
  for(const [before,after] of [[encoded(cursor),encoded(cursor)],[[encoded(cursor)],undefined],['',undefined],['a'.repeat(513),undefined],
    [encoded({...cursor,at:'2026-02-31 00:00:00+00'}),undefined],[encoded({...cursor,at:'tomorrow'}),undefined],['not_json',undefined]])
    expect(()=>historyCursor(before,after)).toThrow();
});
test('fetches the nearest previous rows in ascending order, with a strict cursor and user filter',async()=>{
  await new ReadingRepository().list('user','continue','pdf',cursor,'FILE',true);
  const [sql,values]=mockQuery.mock.calls[0];
  expect(sql).toContain('h.user_id=$1');expect(sql).toContain('(h.last_visited_at,h.id)>');
  expect(sql).toContain('ORDER BY h.last_visited_at ASC,h.id ASC LIMIT 21');
  expect(values).toEqual(['user','continue','pdf',cursor.at,cursor.id,'FILE']);
});
test('keeps the existing forward contract and checks opposite edges without hydrating sources',async()=>{
  const repo=new ReadingRepository();await repo.list('user','recent','',cursor);
  expect(mockQuery.mock.calls[0][0]).toContain('ORDER BY h.last_visited_at DESC,h.id DESC LIMIT 21');
  mockQuery.mockResolvedValue({rows:[{}]});expect(await repo.hasHistory('user','recent','',cursor,'',true)).toBe(true);
  const sql=mockQuery.mock.calls[1][0];expect(sql).toContain('SELECT 1');expect(sql).toContain('LIMIT 1');expect(sql).not.toContain('jsonb_agg');
});
