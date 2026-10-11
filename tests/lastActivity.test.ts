import {expect, jest, test} from '@jest/globals';
import {lastActivityMiddleware} from '../src/middlewares/lastActivityMiddleware';
jest.mock('../src/helpers/Logger', () => ({Logger:class {info() {} error() {}}}));

test.each(['/api/me', '/api/csrf-token', '/api/session/activity'])('does not renew a probe or unvalidated activity: %s', async path => {
  const lastActivity = Date.now() - 600_000;
  const session = {userId:'user', lastActivity};
  const next = jest.fn();
  await lastActivityMiddleware({path, query:{passive:'1'}, session} as any, {} as any, next);
  expect(session.lastActivity).toBe(lastActivity); expect(next).toHaveBeenCalledTimes(1);
});
test('preserves activity on authenticated file requests', async () => {
  const session = {userId:'user', lastActivity:Date.now() - 600_000, touch:jest.fn(), save:jest.fn<(cb: () => void) => void>(cb => cb())};
  const next = jest.fn();
  await lastActivityMiddleware({path:'/books/book.pdf',session} as any, {} as any, next);
  expect(session.lastActivity).toBeGreaterThan(Date.now() - 1000); expect(next).toHaveBeenCalledTimes(1);
  expect(session.save).toHaveBeenCalledTimes(1);
});
test.each(['destroy', 'save'])('a session %s failure returns 503 instead of an unhandled rejection', async operation => {
  const res: any = {setHeader:jest.fn(), status:jest.fn(), json:jest.fn()}; res.status.mockReturnValue(res);
  const next=jest.fn();
  const session={userId:'user', lastActivity:Date.now() - (operation==='destroy'?61:1)*60_000, touch() {},
    [operation]:(cb:(error:Error)=>void)=>cb(new Error('offline'))};
  await lastActivityMiddleware({path:'/books/book.pdf',session} as any,res,next);
  expect(res.status).toHaveBeenCalledWith(503); expect(next).not.toHaveBeenCalled();
});
test('does not create activity for anonymous requests', async () => {
  const session = {};
  await lastActivityMiddleware({path:'/api/me',session} as any, {} as any, jest.fn());
  expect(session).toEqual({});
});
test('keeps old frontend probes compatible during a backend-first deployment', async () => {
  const session={userId:'user',lastActivity:Date.now()-600_000,touch() {},save(cb:()=>void){cb();}};
  await lastActivityMiddleware({path:'/api/me',query:{},session} as any,{} as any,jest.fn());
  expect(session.lastActivity).toBeGreaterThan(Date.now()-1000);
});
