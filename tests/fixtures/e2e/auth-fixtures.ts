/**
 * E2E Auth Fixtures & Demo Accounts for Rangkai.
 * Adheres strictly to AGENTS.md §1, §13, and §16.
 * All accounts and credentials are synthetic test data.
 */

export interface DemoUser {
	id: string;
	email: string;
	name: string;
	role: "organizer" | "officer" | "public";
	organizationId?: string;
	assignedEventId?: string;
}

export const DEMO_USERS = {
	organizer: {
		id: "usr_simulated_organizer_01",
		email: "organizer.simulated@rangkai.local",
		name: "Simulated Organizer Banjar Sari",
		role: "organizer" as const,
		organizationId: "11111111-1111-4111-8111-111111111111",
		password: process.env.SEED_ORGANIZER_PASSWORD || "SimulatedOrganizer123!",
	},
	officer: {
		id: "usr_simulated_officer_01",
		email: "officer.simulated@rangkai.local",
		name: "Simulated Field Officer Pecalang",
		role: "officer" as const,
		organizationId: "11111111-1111-4111-8111-111111111111",
		assignedEventId: "33333333-3333-4333-8333-333333333333",
		password: process.env.SEED_OFFICER_PASSWORD || "SimulatedOfficer123!",
	},
	unassignedOfficer: {
		id: "usr_simulated_unassigned_01",
		email: "unassigned.simulated@rangkai.local",
		name: "Simulated Unassigned Officer",
		role: "officer" as const,
		organizationId: "11111111-1111-4111-8111-111111111111",
		password: "SimulatedUnassigned123!",
	},
	public: {
		id: "anonymous_public",
		email: "",
		name: "Masyarakat Umum (Publik)",
		role: "public" as const,
	},
} as const;

/**
 * Storage state paths for Playwright session caching
 */
export const AUTH_STORAGE_PATHS = {
	organizer: ".auth/organizer.json",
	officer: ".auth/officer.json",
	unassignedOfficer: ".auth/unassigned-officer.json",
};
