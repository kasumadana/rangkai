import type { DbClient } from "../../db/index";
import { auditLogs } from "../../db/schema";

export interface AuditLogParams {
	organizationId: string;
	eventId?: string | null;
	actorId: string | null;
	action: string;
	entityType: string;
	entityId: string;
	beforeJson?: Record<string, unknown> | null;
	afterJson?: Record<string, unknown> | null;
}

export async function recordAuditLog(
	db: DbClient,
	params: AuditLogParams,
): Promise<void> {
	await db.insert(auditLogs).values({
		organizationId: params.organizationId,
		eventId: params.eventId ?? null,
		actorId: params.actorId,
		action: params.action,
		entityType: params.entityType,
		entityId: params.entityId,
		beforeJson: params.beforeJson ?? null,
		afterJson: params.afterJson ?? null,
	});
}
