import type { OpenClawTapdClient, TapNotification, TapNotificationType } from "./tapd-client.js";

const LABELS: Record<TapNotificationType, string> = {
	info: "INFO",
	escalation: "ESCALATION",
	"auto-reply": "AUTO-REPLY",
	summary: "SUMMARY",
};

const MAX_NOTIFICATIONS = 20;
const HEADER = "[TAP Notifications]";

export interface PrependContextResult {
	prependContext: string;
}

/**
 * Formats drained notifications as the `[TAP Notifications]` block. Pure so
 * tests and the flood demo can render without a tapd client.
 *
 * Processing order: drop empty one-liners (they never burn a rendered slot),
 * stable-partition escalations first (arrival order preserved within each
 * class — the 20-line cap can then never silently drop an approval request
 * behind peer chatter), cap at MAX_NOTIFICATIONS, and summarize the omitted
 * tail grouped by peer/type with event counts instead of a bare number.
 * Entries coalesced upstream (`count` >= 2) render an ` (xN)` suffix; `count`
 * absent means 1 — notifications from an older tapd render unchanged.
 */
export function formatNotificationLines(notifications: TapNotification[]): string | null {
	const renderable = notifications.filter((n) => (n.oneLiner ?? "").trim().length > 0);
	if (renderable.length === 0) return null;

	const ordered = [
		...renderable.filter((n) => n.type === "escalation"),
		...renderable.filter((n) => n.type !== "escalation"),
	];

	const lines: string[] = [HEADER];
	for (const notification of ordered.slice(0, MAX_NOTIFICATIONS)) {
		const label = LABELS[notification.type] ?? "INFO";
		lines.push(`- ${label}: ${notification.oneLiner.trim()}${countSuffix(notification)}`);
	}

	const omitted = ordered.slice(MAX_NOTIFICATIONS);
	if (omitted.length > 0) {
		lines.push(`- SUMMARY: omitted: ${summarizeOmitted(omitted)}.`);
	}

	return lines.join("\n");
}

/**
 * Drains queued tapd notifications and wraps the formatted block for the
 * OpenClaw `before_prompt_build` hook. Returns null when there is nothing to
 * surface so the caller can short-circuit without producing an empty block.
 */
export async function drainAndFormatNotifications(
	client: OpenClawTapdClient,
): Promise<PrependContextResult | null> {
	const result = await client.drainNotifications();
	const block = formatNotificationLines(result.notifications ?? []);
	return block === null ? null : { prependContext: block };
}

function countSuffix(notification: TapNotification): string {
	const count = notification.count;
	return typeof count === "number" && count >= 2 ? ` (x${count})` : "";
}

function eventCount(notification: TapNotification): number {
	return typeof notification.count === "number" && notification.count >= 1 ? notification.count : 1;
}

function peerLabel(notification: TapNotification): string | null {
	const data = notification.data;
	if (!data) return null;
	const peerName = data.peerName;
	if (typeof peerName === "string" && peerName.trim().length > 0) return peerName.trim();
	const peerAgentId = data.peerAgentId;
	if (typeof peerAgentId === "number" || typeof peerAgentId === "string") {
		return `agent #${peerAgentId}`;
	}
	return null;
}

function typeBucketLabel(type: TapNotification["type"], events: number): string {
	switch (type) {
		case "escalation":
			return events === 1 ? "escalation" : "escalations";
		case "auto-reply":
			return events === 1 ? "auto-reply" : "auto-replies";
		case "summary":
			return events === 1 ? "summary" : "summaries";
		default:
			return "info";
	}
}

function summarizeOmitted(omitted: TapNotification[]): string {
	const peerBuckets = new Map<string, number>();
	const typeBuckets = new Map<TapNotification["type"], number>();
	for (const notification of omitted) {
		const events = eventCount(notification);
		const label = notification.type === "info" ? peerLabel(notification) : null;
		if (label) {
			peerBuckets.set(label, (peerBuckets.get(label) ?? 0) + events);
		} else {
			typeBuckets.set(notification.type, (typeBuckets.get(notification.type) ?? 0) + events);
		}
	}
	const parts: string[] = [];
	for (const [label, events] of peerBuckets) {
		parts.push(`${events} ${events === 1 ? "message" : "messages"} from ${label}`);
	}
	for (const [type, events] of typeBuckets) {
		parts.push(`${events} ${typeBucketLabel(type, events)}`);
	}
	return parts.join(", ");
}
