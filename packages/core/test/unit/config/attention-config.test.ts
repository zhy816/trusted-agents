import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadTrustedAgentConfigFromDataDir } from "../../../src/config/load.js";
import { validateConfig } from "../../../src/config/schema.js";

describe("attention config", () => {
	let dataDir: string;

	beforeEach(async () => {
		dataDir = await mkdtemp(join(tmpdir(), "attention-config-"));
	});

	afterEach(async () => {
		await rm(dataDir, { recursive: true, force: true });
	});

	it("loads the attention block from config.yaml", async () => {
		await writeFile(
			join(dataDir, "config.yaml"),
			[
				"agent_id: 1",
				"chain: eip155:8453",
				"attention:",
				"  enforce: true",
				"  pricing:",
				'    grantHolder: "0"',
				'    standard: "0.001"',
			].join("\n"),
			"utf-8",
		);

		const config = await loadTrustedAgentConfigFromDataDir(dataDir, { requireAgentId: false });
		expect(config.attention).toEqual({
			enforce: true,
			pricing: { grantHolder: "0", standard: "0.001" },
		});
	});

	it("leaves attention undefined when the block is absent", async () => {
		await writeFile(
			join(dataDir, "config.yaml"),
			["agent_id: 1", "chain: eip155:8453"].join("\n"),
			"utf-8",
		);

		const config = await loadTrustedAgentConfigFromDataDir(dataDir, { requireAgentId: false });
		expect(config.attention).toBeUndefined();
	});

	it("validateConfig accepts a well-formed attention section", () => {
		expect(() =>
			validateConfig({
				agentId: 1,
				chain: "eip155:8453",
				ows: { wallet: "w", apiKey: "ows_key_x" },
				attention: { enforce: true, pricing: { standard: "0.001" } },
			}),
		).not.toThrow();
	});

	it("validateConfig rejects non-decimal pricing values and non-boolean enforce", () => {
		expect(() =>
			validateConfig({
				agentId: 1,
				chain: "eip155:8453",
				ows: { wallet: "w", apiKey: "ows_key_x" },
				attention: { pricing: { standard: "1,50" } },
			}),
		).toThrow("decimal amount string");

		expect(() =>
			validateConfig({
				agentId: 1,
				chain: "eip155:8453",
				ows: { wallet: "w", apiKey: "ows_key_x" },
				attention: { enforce: "yes" as unknown as boolean },
			}),
		).toThrow("attention.enforce must be a boolean");
	});
});
