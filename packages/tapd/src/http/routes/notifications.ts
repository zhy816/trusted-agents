import {
	type AttentionDelta,
	type AttentionPeerRef,
	type FileAttentionLedger,
	attentionPeerKey,
} from "trusted-agents-core";
import { notificationEventCount, planNotificationRender } from "../../notification-format.js";
import type { NotificationQueue, TapNotification } from "../../notification-queue.js";
import type { RouteHandler } from "../router.js";

export interface NotificationsRouteOptions {
	/** When set, every drain records attention accounting before returning. */
	ledger?: Pick<FileAttentionLedger, "record">;
	/** The daemon's own identity, stamped on the ledger file. */
	identity?: () => AttentionPeerRef;
	/**
	 * A ledger write failure must never fail the drain — a 500 here starves
	 * host plugins of notifications. The error is handed here instead.
	 */
	onLedgerError?: (error: unknown) => void;
}

export function createNotificationsRoute(
	queue: NotificationQueue,
	options: NotificationsRouteOptions = {},
): RouteHandler<unknown, { notifications: TapNotification[] }> {
	return async () => {
		const notifications = queue.drain();
		if (options.ledger && notifications.length > 0) {
			try {
				await options.ledger.record(buildAttentionDeltas(notifications), {
					identity: options.identity?.(),
				});
			} catch (error) {
				options.onLedgerError?.(error);
			}
		}
		return { notifications };
	};
}

/**
 * Derives per-peer attention costs for one drained batch from the canonical
 * render plan: each rendered line bills its peer `ceil(chars/4)` tokens plus
 * one rendered notification; block overhead (header/footer) bills the
 * unattributed bucket; omitted entries bill their peer the suppressed event
 * count. Escalations are counted per drained notification whether rendered
 * or not. Peers resolve from `data.peerChain` + `data.peerAgentId`; action
 * lifecycle events carry no peer on the wire and land unattributed.
 */
export function buildAttentionDeltas(notifications: TapNotification[]): AttentionDelta[] {
	const deltas = new Map<string, AttentionDelta>();
	const bump = (
		peer: AttentionPeerRef | null,
		field: "notificationsRendered" | "tokensInjected" | "escalations" | "overflowSuppressed",
		amount: number,
	): void => {
		if (amount === 0) return;
		const key = attentionPeerKey(peer);
		let delta = deltas.get(key);
		if (!delta) {
			delta = { peer };
			deltas.set(key, delta);
		}
		delta[field] = (delta[field] ?? 0) + amount;
	};

	for (const notification of notifications) {
		if (notification.type === "escalation") {
			bump(peerOf(notification), "escalations", 1);
		}
	}

	const plan = planNotificationRender(notifications);
	if (plan) {
		for (const { notification, line } of plan.rendered) {
			const peer = peerOf(notification);
			bump(peer, "notificationsRendered", 1);
			bump(peer, "tokensInjected", estimateTokens(line));
		}
		let overheadChars = plan.header.length;
		if (plan.footer !== null) {
			overheadChars += plan.footer.length + 1;
		}
		bump(null, "tokensInjected", Math.ceil(overheadChars / 4));
		for (const notification of plan.omitted) {
			bump(peerOf(notification), "overflowSuppressed", notificationEventCount(notification));
		}
	}

	return [...deltas.values()];
}

function estimateTokens(text: string): number {
	// +1 for the newline joining the line into the injected block.
	return Math.ceil((text.length + 1) / 4);
}

function peerOf(notification: TapNotification): AttentionPeerRef | null {
	const data = notification.data;
	if (!data) return null;
	const chain = data.peerChain;
	const agentId = data.peerAgentId;
	if (typeof chain === "string" && chain.length > 0 && typeof agentId === "number") {
		return { chain, agentId };
	}
	return null;
}
