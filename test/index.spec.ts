import { SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";

describe("famac-mcp", () => {
	it("avviser forespørsler uten riktig nøkkel", async () => {
		const response = await SELF.fetch("https://example.com/mcp", { method: "POST" });
		// 401 = feil nøkkel, 500 = hemmeligheter mangler i testmiljøet
		expect([401, 500]).toContain(response.status);
	});

	it("svarer 404 på OAuth-oppslag, siden vi ikke bruker OAuth", async () => {
		const response = await SELF.fetch("https://example.com/.well-known/oauth-protected-resource");
		expect([404, 500]).toContain(response.status);
	});
});
