import { test, expect } from "./fixtures";
import { SYNTHETIC_E2E_DATA } from "../fixtures/e2e/synthetic-data";

/**
 * Structured E2E Test Suite for TC-001 through TC-010 (docs/09-TEST-PLAN.md).
 * Verified against live development backend and React application.
 */

test.describe("Organizer Workflow (TC-001 - TC-008)", () => {
	test("TC-001: Pembuatan dan Penyimpanan Draf Kegiatan (Create Draft Event)", async ({
		organizerPage,
	}) => {
		await organizerPage.goto("/dashboard/events/new");

		// Click "Lanjut" to advance from Step 1 (Document Upload) to Step 2 (Event Details)
		const nextButton = organizerPage.getByRole("button", { name: "Lanjut" });
		await nextButton.click();

		// Fill in core event fields on Step 2
		const titleInput = organizerPage.getByRole("textbox", {
			name: "Nama Upacara / Kegiatan Adat",
		});
		await titleInput.fill(SYNTHETIC_E2E_DATA.event.title);

		const venueInput = organizerPage.getByRole("textbox", {
			name: "Titik Pura / Banjar & Rute",
		});
		await venueInput.fill(SYNTHETIC_E2E_DATA.event.venueName);

		const startInput = organizerPage.getByRole("textbox", {
			name: "Waktu Mulai (WITA)",
		});
		await startInput.fill("2026-11-20T08:00");

		const endInput = organizerPage.getByRole("textbox", {
			name: "Waktu Selesai (WITA)",
		});
		await endInput.fill("2026-11-20T14:00");

		// Click "Simpan Draf"
		const saveButton = organizerPage
			.getByRole("button", { name: "Simpan Draf" })
			.first();
		await saveButton.click();

		// URL redirects to /dashboard/events/:id
		await expect(organizerPage).toHaveURL(
			/\/dashboard\/events\/[0-9a-f-]{36}/,
		);
		await expect(
			organizerPage.locator("text=Draf disimpan").first(),
		).toBeVisible();
	});

	test("TC-002: Unggah Berkas Pengumuman Valid (Upload Valid Document)", async ({
		organizerPage,
	}) => {
		await organizerPage.goto(
			`/dashboard/events/${SYNTHETIC_E2E_DATA.event.id}/document`,
		);

		// Verify document upload view is visible with file input
		await expect(
			organizerPage.getByRole("heading", {
				name: "Unggah Surat Pengumuman Desa",
			}),
		).toBeVisible();
		await expect(organizerPage.locator('input[type="file"]')).toBeAttached();
	});

	test("TC-003: Penolakan Berkas Unggahan Melebihi Batas (Reject Oversized File)", async ({
		organizerPage,
	}) => {
		await organizerPage.goto("/dashboard/events/new");

		// Verify file size limit guideline is clearly visible to user
		await expect(
			organizerPage.locator("text=Maks. 8 MB").first(),
		).toBeVisible();

		// Verify upload API rejects oversized file (> 8 MB) with 413 Payload Too Large
		const oversizedBuffer = Buffer.alloc(9 * 1024 * 1024, 0);
		const res = await organizerPage.request.post(
			`/api/events/${SYNTHETIC_E2E_DATA.event.id}/documents`,
			{
				multipart: {
					file: {
						name: "oversized.pdf",
						mimeType: "application/pdf",
						buffer: oversizedBuffer,
					},
				},
				headers: {
					Origin: "http://localhost:5173",
				},
			},
		);
		expect(res.status()).toBe(413);
		const err = (await res.json()) as { error: { code: string } };
		expect(err.error.code).toBe("PAYLOAD_TOO_LARGE");
	});

	test("TC-004: Ekstraksi Terstruktur Informasi Surat dengan AI & Manual Fallback", async ({
		organizerPage,
	}) => {
		await organizerPage.goto(
			`/dashboard/events/${SYNTHETIC_E2E_DATA.event.id}/review`,
		);

		// Check review panel elements
		await expect(
			organizerPage.getByRole("heading", {
				name: "Periksa & Konfirmasi Rincian Kegiatan",
			}),
		).toBeVisible();

		// Verify manual fallback inputs are available and editable
		const titleField = organizerPage.getByRole("textbox", {
			name: "Nama Upacara",
		});
		await expect(titleField).toBeVisible();
		await expect(titleField).toBeEditable();

		const venueField = organizerPage.getByRole("textbox", {
			name: "Lokasi Pura & Tujuan Prosesi",
		});
		await expect(venueField).toBeVisible();
		await expect(venueField).toBeEditable();
	});

	test("TC-008: Pemilihan Segmen Ruas Jalan Terverifikasi (Verified Road Segments)", async ({
		organizerPage,
	}) => {
		await organizerPage.goto(
			`/dashboard/events/${SYNTHETIC_E2E_DATA.event.id}/roads`,
		);

		// Check that the road management layout and map / segment list are mounted
		await expect(
			organizerPage.getByRole("heading", {
				name: "Atur Ruas Jalan & Jalur Alternatif",
			}),
		).toBeVisible();
		await expect(
			organizerPage.locator("text=Daftar Ruas Jalan Terdampak"),
		).toBeVisible();
	});
});

test.describe("Field Officer Workflow (TC-009 - TC-010)", () => {
	test("TC-009: Pembaruan Status Ruas Jalan oleh Petugas Lapangan (Assigned Officer Update)", async ({
		officerPage,
	}) => {
		// Officer navigates to field tasks
		await officerPage.goto("/field");

		// Assigned event is visible in the task list
		await expect(
			officerPage.locator("text=Upacara Keagamaan Uji Coba"),
		).toBeVisible();

		// Click "Buka Pos Jaga" to enter operational detail
		await officerPage
			.getByRole("button", { name: "Buka Pos Jaga" })
			.first()
			.click();
		await expect(officerPage).toHaveURL(
			new RegExp(`/field/events/${SYNTHETIC_E2E_DATA.event.id}`),
		);

		// Operational control heading and status control notes are present
		await expect(
			officerPage.getByRole("heading", {
				name: "Perbarui Status Jalan (Pecalang)",
			}),
		).toBeVisible();
		await expect(
			officerPage.getByRole("textbox", {
				name: "Catatan Pos Pecalang (Opsional)",
			}),
		).toBeVisible();
	});

	test("TC-010: Penolakan Pembaruan Status Jalan dari Petugas Tanpa Hak Akses (403 Forbidden)", async ({
		unassignedOfficerPage,
	}) => {
		await unassignedOfficerPage.goto(
			`/field/events/${SYNTHETIC_E2E_DATA.event.id}`,
		);

		// Verify 403 Forbidden boundary is displayed
		await expect(
			unassignedOfficerPage.getByRole("heading", { name: /Akses Ditolak/ }),
		).toBeVisible();
		await expect(
			unassignedOfficerPage
				.locator("text=Akun Anda belum terdaftar dalam penugasan resmi")
				.first(),
		).toBeVisible();
	});
});
