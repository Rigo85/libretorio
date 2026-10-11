import { beforeEach, expect, jest, test } from "@jest/globals";
import { UserRepository } from "../src/repositories/UserRepository";
const mockQuery = jest.fn<(...args: any[]) => Promise<any>>();
jest.mock("../src/db/PostgresAdapter", () => ({PostgresAdapter: {getInstance: () => ({pool: {query: mockQuery}})}}));
jest.mock("../src/helpers/Logger", () => ({Logger: class {error() {}}}));
beforeEach(() => mockQuery.mockReset());
test("does not collapse authentication query failures into missing users", async () => {
	mockQuery.mockRejectedValue(new Error("Database offline"));
	await expect(UserRepository.getInstance().getSessionId("user")).rejects.toThrow("Database offline");
	await expect(UserRepository.getInstance().getWebSocketSession("user", "sid")).rejects.toThrow("Database offline");
});
test("session creation must update exactly one active user", async () => {
	mockQuery.mockResolvedValue({rowCount: 0});
	expect(await UserRepository.getInstance().updateSessionId("user", "sid", "hash")).toBe(false);
	mockQuery.mockResolvedValue({rowCount: 1});
	expect(await UserRepository.getInstance().updateSessionId("user", "sid", "hash")).toBe(true);
});
test('a delayed login cannot establish a session using a password hash replaced by reset',async()=>{
 mockQuery.mockResolvedValue({rowCount:0});
 expect(await UserRepository.getInstance().updateSessionId('user','sid','verified-old-hash')).toBe(false);
 expect(mockQuery.mock.calls[0][0]).toContain('password_hash=$3');
 expect(mockQuery.mock.calls[0][1]).toEqual(['sid','user','verified-old-hash']);
});
test("a missing session is not a successful match", async () => {
	mockQuery.mockResolvedValue({rows: []});
	expect(await UserRepository.getInstance().getSessionId("user")).toBeUndefined();
	expect(await UserRepository.getInstance().getWebSocketSession("user", "sid")).toBeUndefined();
});
test('returns persisted activity only from a live, active, matching session', async () => {
	mockQuery.mockResolvedValue({rows: [{isAdmin: false, lastActivity: '1800000000000'}]});
	expect(await UserRepository.getInstance().getWebSocketSession('user', 'sid')).toEqual({isAdmin: false, lastActivity: 1800000000000});
	const [sql, params] = mockQuery.mock.calls[0];
	expect(sql).toContain('expire > NOW()');
	expect(params).toEqual(['user', 'sid']);
});
test('logout invalidates only its own session, not a newer login', async () => {
	mockQuery.mockResolvedValue({rowCount: 0});
	await UserRepository.getInstance().invalidateSession('user', 'old-sid');
	const [sql, params] = mockQuery.mock.calls[0];
	expect(sql).toContain('WHERE id = $1 AND session_id = $2');
	expect(params).toEqual(['user', 'old-sid']);
});
