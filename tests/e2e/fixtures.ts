/* eslint-disable react-hooks/rules-of-hooks */
import { test as base, type Page } from "@playwright/test";
import { DEMO_USERS } from "../fixtures/e2e/auth-fixtures";

export interface RangkaiFixtures {
	organizerPage: Page;
	officerPage: Page;
	unassignedOfficerPage: Page;
	publicPage: Page;
}

/**
 * Extended Playwright test with pre-configured role contexts.
 */
export const test = base.extend<RangkaiFixtures>({
	// 1. Organizer Context
	organizerPage: async ({ browser, baseURL }, use) => {
		const context = await browser.newContext();
		const page = await context.newPage();

		const res = await context.request.post(`${baseURL}/api/auth/sign-in/email`, {
			data: {
				email: DEMO_USERS.organizer.email,
				password: DEMO_USERS.organizer.password,
			},
			headers: {
				"Content-Type": "application/json",
				Origin: baseURL || "http://localhost:5173",
			},
		});
		if (!res.ok()) {
			throw new Error(
				`Failed to sign in organizer fixture: HTTP ${res.status()} ${await res.text()}`,
			);
		}

		await use(page);
		await context.close();
	},

	// 2. Field Officer Context (Assigned)
	officerPage: async ({ browser, baseURL }, use) => {
		const context = await browser.newContext();
		const page = await context.newPage();

		const res = await context.request.post(`${baseURL}/api/auth/sign-in/email`, {
			data: {
				email: DEMO_USERS.officer.email,
				password: DEMO_USERS.officer.password,
			},
			headers: {
				"Content-Type": "application/json",
				Origin: baseURL || "http://localhost:5173",
			},
		});
		if (!res.ok()) {
			throw new Error(
				`Failed to sign in officer fixture: HTTP ${res.status()} ${await res.text()}`,
			);
		}

		await use(page);
		await context.close();
	},

	// 3. Unassigned Officer Context (for 403 authorization testing)
	unassignedOfficerPage: async ({ browser, baseURL }, use) => {
		const context = await browser.newContext();
		const page = await context.newPage();

		const res = await context.request.post(`${baseURL}/api/auth/sign-in/email`, {
			data: {
				email: DEMO_USERS.unassignedOfficer.email,
				password: DEMO_USERS.unassignedOfficer.password,
			},
			headers: {
				"Content-Type": "application/json",
				Origin: baseURL || "http://localhost:5173",
			},
		});
		if (!res.ok()) {
			throw new Error(
				`Failed to sign in unassigned officer fixture: HTTP ${res.status()} ${await res.text()}`,
			);
		}

		await use(page);
		await context.close();
	},

	// 4. Anonymous Public Context
	publicPage: async ({ browser }, use) => {
		const context = await browser.newContext();
		const page = await context.newPage();
		await use(page);
		await context.close();
	},
});

export { expect } from "@playwright/test";
