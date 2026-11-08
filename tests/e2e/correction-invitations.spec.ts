import { test, expect } from "@playwright/test";
import { and, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { assertDevBranch } from "../../src/db/guard";
import { getDb } from "../../src/db";
import { account, session, user } from "../../src/db/auth-schema";
import { auditLogs, eventAssignments, events, invitations, memberships, organizations } from "../../src/db/schema";

// Bearer invitation URLs must not be persisted in browser traces or screenshots.
test.use({ trace: "off", screenshot: "off", video: "off" });

for (const role of ["officer", "organizer"] as const) {
	test(`recipient registers and accepts an ${role} invitation`, async ({ browser, baseURL }) => {
		const { pinnedUrl } = await assertDevBranch();
		const db = getDb(pinnedUrl);
		const key = randomUUID().slice(0, 8);
		const senderEmail = `sender.${key}@test.local`;
		const recipientEmail = `recipient.${key}@test.local`;
		const orgName = `Invitation test ${key}`;
		const sender = await browser.newContext({ extraHTTPHeaders: { Origin: baseURL || "http://localhost:5173" } });
		const recipient = await browser.newContext();
		try {
			const signup = await sender.request.post(`${baseURL}/api/auth/sign-up/email`, { data: { name: "Synthetic Sender", email: senderEmail, password: "SyntheticBrowserPass123!" } });
			expect(signup.status()).toBe(200);
			const orgRes = await sender.request.post(`${baseURL}/api/organizations`, { data: { name: orgName, village: "Wilayah uji", district: "Gianyar" } });
			expect(orgRes.status()).toBe(201);
			const org = await orgRes.json() as { organization: { id: string } };
			const eventRes = await sender.request.post(`${baseURL}/api/events`, { data: { organizationId: org.organization.id, title: `Synthetic event ${key}` } });
			expect(eventRes.status()).toBe(201);
			const event = await eventRes.json() as { event: { id: string } };
			const invitationRes = await sender.request.post(`${baseURL}/api/invitations`, { data: { organizationId: org.organization.id, eventId: role === "officer" ? event.event.id : undefined, role, recipientEmail, canUpdateTraffic: role === "officer" } });
			expect(invitationRes.status()).toBe(201);
			const invitation = await invitationRes.json() as { invitation: { token: string } };
			const inspection = await recipient.request.get(`${baseURL}/api/invitations/${invitation.invitation.token}`);
			expect(inspection.status()).toBe(200);
			const page = await recipient.newPage();
			await page.goto(`/invite/${invitation.invitation.token}`);
			await expect(page.getByText(role === "organizer" ? "Undangan Penyelenggara" : "Undangan Petugas Lapangan", { exact: true })).toBeVisible();
			await page.getByRole("link", { name: "Daftar Akun" }).click();
			await page.reload();
			await page.locator("#reg-name").fill("Synthetic Recipient");
			await page.locator("#reg-email").fill(recipientEmail);
			await page.locator("#reg-password").fill("SyntheticBrowserPass123!");
			await page.locator("#reg-confirm").fill("SyntheticBrowserPass123!");
			const signedUp = page.waitForResponse((r) => r.url().includes("/api/auth/sign-up/email") && r.request().method() === "POST");
			await page.getByRole("button", { name: "Daftar Akun Baru" }).click();
			expect((await signedUp).ok()).toBe(true);
			await page.getByRole("link", { name: "Buka Undangan & Konfirmasi Hak Akses" }).click();
			const accepted = page.waitForResponse((r) => r.url().endsWith("/accept") && r.request().method() === "POST");
			await page.getByRole("button", { name: "Terima Undangan & Mulai Bertugas" }).click();
			expect((await accepted).status()).toBe(200);
			await expect(page).toHaveURL(role === "officer" ? new RegExp(`/field/events/${event.event.id}`) : /\/dashboard/);
			await page.reload();
			const [joined] = await db.select({ id: user.id }).from(user).where(eq(user.email, recipientEmail));
			const [member] = await db.select().from(memberships).where(and(eq(memberships.organizationId, org.organization.id), eq(memberships.userId, joined.id)));
			expect(member.role).toBe(role);
			const grants = await db.select().from(eventAssignments).where(and(eq(eventAssignments.eventId, event.event.id), eq(eventAssignments.userId, joined.id)));
			expect(grants.length).toBe(role === "officer" ? 1 : 0);
		} finally {
			await sender.close(); await recipient.close();
			const people = await db.select({ id: user.id }).from(user).where(inArray(user.email, [senderEmail, recipientEmail]));
			const [org] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.name, orgName));
			if (org) {
				await db.delete(invitations).where(eq(invitations.organizationId, org.id));
				const owned = await db.select({ id: events.id }).from(events).where(eq(events.organizationId, org.id));
				if (owned.length) await db.delete(eventAssignments).where(inArray(eventAssignments.eventId, owned.map((e) => e.id)));
				await db.delete(auditLogs).where(eq(auditLogs.organizationId, org.id));
				await db.delete(events).where(eq(events.organizationId, org.id));
				await db.delete(memberships).where(eq(memberships.organizationId, org.id));
				await db.delete(organizations).where(eq(organizations.id, org.id));
			}
			if (people.length) {
				const ids = people.map((person) => person.id);
				await db.delete(session).where(inArray(session.userId, ids));
				await db.delete(account).where(inArray(account.userId, ids));
				await db.delete(user).where(inArray(user.id, ids));
			}
		}
	});
}
