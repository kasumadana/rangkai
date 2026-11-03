import type { User, Session } from "better-auth";
import type { DbClient } from "../db";
import type { AuthInstance } from "./auth";
import type { MembershipRole } from "../db/schema";

export interface Env {
	DATABASE_URL?: string;
	DATABASE_URL_UNPOOLED?: string;
	BETTER_AUTH_SECRET?: string;
	BETTER_AUTH_URL?: string;
}

export interface AppVariables {
	requestId: string;
	db: DbClient;
	auth: AuthInstance;
	user?: User;
	session?: Session;
	orgMembership?: {
		organizationId: string;
		userId: string;
		role: MembershipRole;
	};
}
