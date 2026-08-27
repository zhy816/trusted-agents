import { randomUUID } from "node:crypto";
import type { TapEvent } from "trusted-agents-core";
import type { TapNotification, TapNotificationType } from "./notification-queue.js";

export function classifyEventToNotification(event: TapEvent): TapNotification | null {
	const note = (
		type: TapNotificationType,
		oneLiner: string,
		data: Record<string, unknown>,
		coalesce?: { key: string; strategy: "count" | "replace" },
	): TapNotification => ({
		id: `note-${randomUUID()}`,
		type,
		oneLiner,
		createdAt: event.occurredAt,
		data,
		...(coalesce ? { coalesceKey: coalesce.key, coalesceStrategy: coalesce.strategy } : {}),
	});

	switch (event.type) {
		case "action.pending":
			return note(
				"escalation",
				`Pending ${event.kind} request awaiting approval (${event.requestId})`,
				{
					requestId: event.requestId,
					kind: event.kind,
					conversationId: event.conversationId,
				},
				// One key per request lifecycle: a later completed/failed event
				// replaces the stale pending line still sitting in the queue.
				// Safe because core marks the journal completed before emitting
				// those events, so a replaced escalation never still needs an
				// operator decision.
				{ key: `req:${event.requestId}`, strategy: "replace" },
			);
		case "connection.requested":
			if (event.direction !== "inbound") return null;
			return note("escalation", `Inbound connection request from agent #${event.peerAgentId}`, {
				requestId: event.requestId,
				peerAgentId: event.peerAgentId,
				peerChain: event.peerChain,
			});
		case "message.received":
			return note(
				"info",
				`New message from ${event.peer.peerName || "peer"}: ${truncate(event.text, 80)}`,
				{
					conversationId: event.conversationId,
					connectionId: event.peer.connectionId,
					peerAgentId: event.peer.peerAgentId,
					peerName: event.peer.peerName,
				},
				{ key: `msg:${event.peer.connectionId}`, strategy: "count" },
			);
		case "connection.established":
			return note("info", `Connection established with ${event.peer.peerName || "peer"}`, {
				connectionId: event.connectionId,
				peerAgentId: event.peer.peerAgentId,
			});
		case "connection.failed":
			return note("escalation", `Connection request ${event.requestId} failed: ${event.error}`, {
				requestId: event.requestId,
			});
		case "action.completed":
			return note(
				"info",
				`${event.kind} action ${event.requestId} completed`,
				{
					requestId: event.requestId,
					kind: event.kind,
					...(event.txHash ? { txHash: event.txHash } : {}),
				},
				{ key: `req:${event.requestId}`, strategy: "replace" },
			);
		case "action.failed":
			return note(
				"escalation",
				`${event.kind} action ${event.requestId} failed: ${event.error}`,
				{
					requestId: event.requestId,
					kind: event.kind,
				},
				{ key: `req:${event.requestId}`, strategy: "replace" },
			);
		default:
			return null;
	}
}

function truncate(text: string, max: number): string {
	if (text.length <= max) return text;
	return `${text.slice(0, max)}…`;
}
