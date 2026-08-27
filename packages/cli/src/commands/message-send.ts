import {
	DEFAULT_MESSAGE_SCOPE,
	MESSAGE_SEND,
	type RegistrationFileAttention,
	ValidationError,
	findActiveGrantsByScope,
	findContactForPeer,
} from "trusted-agents-core";
import { loadConfig } from "../lib/config-loader.js";
import { buildContext } from "../lib/context.js";
import { handleCommandError } from "../lib/errors.js";
import { success, verbose } from "../lib/output.js";
import { TapdClient } from "../lib/tapd-client.js";
import type { GlobalOptions } from "../types.js";

export async function messageSendCommand(
	peer: string,
	text: string,
	opts: GlobalOptions,
	cmdOpts?: { scope?: string; dryRun?: boolean },
): Promise<void> {
	const startTime = Date.now();

	try {
		const config = await loadConfig(opts);
		const scope = cmdOpts?.scope?.trim() || DEFAULT_MESSAGE_SCOPE;

		if (cmdOpts?.dryRun) {
			// Pure local preview: contact from the trust store, price list from
			// the (cached) registration file. No transport, nothing sent.
			const context = buildContext(config);
			const contacts = await context.trustStore.getContacts();
			const contact = findContactForPeer(contacts, peer);
			if (!contact) {
				throw new ValidationError(`Peer not found in contacts: ${peer}`);
			}
			let attention: RegistrationFileAttention | undefined;
			try {
				const resolved = await context.resolver.resolveWithCache(
					contact.peerAgentId,
					contact.peerChain,
					config.resolveCacheTtlMs,
				);
				attention = resolved.attention;
			} catch {
				// Resolution failure just means the price is unknown; the
				// preview still shows the message that would be sent.
			}
			// My tier at THEIR gate: grants the peer issued to me.
			const holdsGrant =
				findActiveGrantsByScope(contact.permissions.grantedByPeer, MESSAGE_SEND).length > 0;
			const tier = holdsGrant ? "grantHolder" : "standard";
			const estimatedCost = attention
				? (attention.pricing[tier] ?? attention.pricing.standard ?? null)
				: null;
			success(
				{
					status: "preview",
					dry_run: true,
					peer: contact.peerDisplayName,
					agent_id: contact.peerAgentId,
					scope,
					text_chars: text.length,
					attention_currency: attention?.currency ?? null,
					attention_pricing: attention?.pricing ?? null,
					estimated_tier: attention ? tier : null,
					estimated_cost: estimatedCost,
				},
				opts,
				startTime,
			);
			return;
		}

		const client = await TapdClient.forDataDir(config.dataDir);
		verbose(`Sending message to ${peer}...`, opts);

		const result = await client.sendMessage({ peer, text, scope });

		success(
			{
				sent: true,
				peer: result.peerName,
				agent_id: result.peerAgentId,
				scope: result.scope,
				receipt: result.receipt,
			},
			opts,
			startTime,
		);
	} catch (err) {
		handleCommandError(err, opts);
	}
}
