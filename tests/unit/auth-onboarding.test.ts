import { describe, expect, it } from "vitest";
import { createOrganizationSchema } from "../../src/worker/routes/organizations";
import { createInvitationSchema } from "../../src/worker/routes/invitations";

describe("Rangkai Auth & Onboarding Domain Validations (message (2).txt)", () => {
	it("validates organization creation with proper name and district", () => {
		const valid = createOrganizationSchema.safeParse({
			name: "Desa Adat Padangtegal",
			district: "Kabupaten Gianyar",
			village: "Ubud",
		});
		expect(valid.success).toBe(true);
		if (valid.success) {
			expect(valid.data.name).toBe("Desa Adat Padangtegal");
			expect(valid.data.district).toBe("Kabupaten Gianyar");
		}
	});

	it("rejects organization names that are too short (< 3 characters)", () => {
		const invalid = createOrganizationSchema.safeParse({
			name: "DA",
			district: "Gianyar",
		});
		expect(invalid.success).toBe(false);
	});

	it("validates officer invitation creation payload", () => {
		const valid = createInvitationSchema.safeParse({
			eventId: "123e4567-e89b-12d3-a456-426614174000",
			canUpdateTraffic: true,
			canUpdateCleanup: false,
			expiresInDays: 7,
		});
		expect(valid.success).toBe(true);
		if (valid.success) {
			expect(valid.data.canUpdateTraffic).toBe(true);
			expect(valid.data.canUpdateCleanup).toBe(false);
			expect(valid.data.expiresInDays).toBe(7);
		}
	});

	it("rejects invitation creation with invalid eventId format", () => {
		const invalid = createInvitationSchema.safeParse({
			eventId: "not-a-uuid",
			canUpdateTraffic: true,
		});
		expect(invalid.success).toBe(false);
	});
});
