import {userEmail, userPassword, userId, UserManagement, UserManagementError} from '../src/services/UserManagement';
import {test, expect, jest} from '@jest/globals';

test('normalizes account email and rejects ambiguous invalid input',()=>{
 expect(userEmail(' TEST@Example.com ')).toBe('test@example.com');
 for(const value of [null,[],{},'a b@c.com','a@b','a@@b.com','x'.repeat(255)+'@a.com'])expect(()=>userEmail(value)).toThrow(UserManagementError);
});
test('new passwords support passphrases and Unicode without truncation or composition rules',()=>{
 expect(userPassword('una frase larga para probar')).toBe('una frase larga para probar');
 expect(userPassword('x'.repeat(256))).toHaveLength(256);
 for(const value of ['',null,'short',' '.repeat(15),'x'.repeat(257)])expect(()=>userPassword(value)).toThrow(UserManagementError);
});
test('accepts UUID identifiers only',()=>{
 expect(userId('00000000-0000-4000-8000-000000000001')).toBe('00000000-0000-4000-8000-000000000001');
 for(const id of [1,null,{},"' OR 1=1",'abc'])expect(()=>userId(id)).toThrow(UserManagementError);
});
test('authorization uses current persisted active session, not client role',async()=>{
 const query=jest.fn<(...args:any[])=>Promise<any>>().mockResolvedValue({rows:[{id:'actor',is_admin:false}]});
 const service=new UserManagement({query} as any);
 await expect(service.authorize({userId:'actor',sessionId:'sid'})).rejects.toMatchObject({status:403,code:'ADMIN_REQUIRED'});
 expect(query.mock.calls[0][0]).toContain('s.expire>now()');expect(query.mock.calls[0][0]).toContain('u.is_active=true');
 query.mockRejectedValue(new Error('offline'));await expect(service.authorize({userId:'actor',sessionId:'sid'})).rejects.toThrow('offline');
});
test('mass assignment is rejected before database writes',async()=>{
 const query=jest.fn(),service=new UserManagement({query} as any);
 await expect(service.create({userId:'a',sessionId:'s'},{email:'a@b.com',password_hash:'injected'})).rejects.toMatchObject({code:'INVALID_USER'});
 expect(query).not.toHaveBeenCalled();
});
