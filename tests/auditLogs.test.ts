import {beforeEach, expect, jest, test} from '@jest/globals';
import {AuditLogsRepository} from '../src/repositories/AuditLogsRepository';
const mockQuery = jest.fn<(...args: any[]) => Promise<any>>();
jest.mock('../src/db/PostgresAdapter', () => ({PostgresAdapter:{getInstance:()=>({query:mockQuery})}}));
jest.mock('../src/helpers/Logger', () => ({Logger:class {info() {} error() {}}}));
beforeEach(()=>mockQuery.mockReset());
test.each([123,'123'])('preserves archive reference %s without sending an integer to a UUID column',async id=>{
	await AuditLogsRepository.getInstance().insert('user','Book',id,'Listen to',{position:42});
	const values=mockQuery.mock.calls[0][1];
	expect(values[2]).toBeUndefined();
	expect(JSON.parse(values[4])).toEqual({position:42,archiveId:123});
});
test('preserves existing UUID entities and changes',async ()=>{
	const id='00000000-0000-4000-8000-000000000001';
	await AuditLogsRepository.getInstance().insert('user','Book',id,'Read',{key:'value'});
	const values=mockQuery.mock.calls[0][1];
	expect(values[2]).toBe(id);expect(JSON.parse(values[4])).toEqual({key:'value'});
});
test('preserves an unsupported reference without causing a UUID syntax failure',async ()=>{
	await AuditLogsRepository.getInstance().insert('user','Book','bad-id','Read',{});
	const values=mockQuery.mock.calls[0][1];
	expect(values[2]).toBeUndefined();expect(JSON.parse(values[4])).toEqual({entityId:'bad-id'});
});
