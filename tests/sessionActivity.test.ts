import { expect, jest, test } from '@jest/globals';
import { sessionActivity } from '../src/controllers/sessionActivity';

function response() {
	const res: any = {setHeader: jest.fn(), vary: jest.fn(), status: jest.fn(), json: jest.fn(), sendStatus: jest.fn()};
	res.status.mockReturnValue(res);
	return res;
}
test.each([undefined, {}])('does not renew an anonymous session', async session => {
	const res = response();
	await sessionActivity({session, body: {activity: 'audio'}} as any, res);
	expect(res.status).toHaveBeenCalledWith(401);
});
test.each(['audio', 'interaction'])('saves approved %s activity after touching the cookie', async activity => {
	const session = {userId: 'user', touch: jest.fn(), save: jest.fn<(cb: (error?: Error) => void) => void>(cb => cb())};
	const res = response();
	await sessionActivity({session, body: {activity}} as any, res);
	expect(session.touch).toHaveBeenCalledTimes(1);
	expect(session.save).toHaveBeenCalledTimes(1);
	expect((session as any).lastActivity).toBeGreaterThan(Date.now() - 1000);
	expect(res.sendStatus).toHaveBeenCalledWith(204);
	expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
});
test('a failed session save returns unavailable, not success or expiration', async () => {
	const res = response();
	await sessionActivity({session: {userId: 'user', touch() {}, save(cb: any) {cb(new Error('offline'));}}, body: {activity: 'audio'}} as any, res);
	expect(res.status).toHaveBeenCalledWith(503);
});
test('rejects unsupported activity', async () => {
	const res = response();
	await sessionActivity({session: {userId: 'user'}, body: {activity: 'idle'}} as any, res);
	expect(res.status).toHaveBeenCalledWith(400);
});
