import {expect, test} from "bun:test";
import {once} from "node:events";
import type {AddressInfo} from "node:net";
await import("../testSettings");
const {createRunnerServer} = await import("./server");

test("準備完了までは実行を受け付けず、同じポートで起動中の状態を返す", async () => {
	let ready = false;
	const server = createRunnerServer(() => {}, () => ready);
	const listening = once(server, "listening");
	server.listen(0, "127.0.0.1");
	await listening;
	try {
		const {port} = server.address() as AddressInfo;
		const post = (mode: string) => fetch(`http://127.0.0.1:${port}`, {method: "POST", body: JSON.stringify({mode})});
		for (const mode of ["status", "list", "run"]) {
			const response = await post(mode);
			expect(response.status).toBe(503);
			expect(await response.json()).toMatchObject({status: "starting"});
		}
		ready = true;
		const status = await post("status");
		expect(status.status).toBe(200);
		expect(await status.json()).toMatchObject({status: "running", pid: process.pid});
	} finally {
		const closed = once(server, "close");
		server.close();
		await closed;
	}
});
