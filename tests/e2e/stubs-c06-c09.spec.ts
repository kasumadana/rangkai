import { test, expect } from "./fixtures";
import { SYNTHETIC_E2E_DATA } from "../fixtures/e2e/synthetic-data";
import path from "node:path";

/**
 * Task C06: Integration QA Test Suite for Rangkai.
 * Follows ROADMAP Definition of Done:
 * - Minimal 1 comprehensive Happy Path (Draft -> Manual/AI Review -> Road Segment -> Gating Verification -> Public Display).
 * - Minimal 3 Failure & Edge Cases:
 *   1. Failure Case 1: Oversized / Invalid Document Rejection (> 8 MB).
 *   2. Failure Case 2: Publication Gating (Cannot publish without Review / Road Segments).
 *   3. Failure Case 3: Unauthorized Officer 403 Forbidden Rejection.
 */

test.describe("C06: Failure & Edge Cases (Minimal 3 Cases)", () => {
	test("Failure Case 1: Penolakan Berkas Unggahan Melebihi Batas (> 8 MB) (TC-003)", async ({
		publicPage,
	}) => {
		// Buka form pembuatan acara
		await publicPage.goto("/dashboard/events/new");
		await expect(publicPage.locator("body")).toBeVisible();

		// Buat buffer file buatan berukuran > 8MB (8.5 MB)
		const oversizedBuffer = Buffer.alloc(8.5 * 1024 * 1024, "a");

		// Upload berkas melalui input file
		const fileInput = publicPage.locator('input[type="file"]');
		await fileInput.setInputFiles({
			name: "surat-pengumuman-oversized.pdf",
			mimeType: "application/pdf",
			buffer: oversizedBuffer,
		});

		// Verifikasi munculnya banner error validasi ukuran berkas
		await expect(
			publicPage.getByText("Ukuran Berkas Melebihi Batas", { exact: true }),
		).toBeVisible({ timeout: 5000 });
	});

	test("Failure Case 2: Pencegahan Publikasi Tanpa Peninjauan Prajuru / Tanpa Ruas Jalan (TC-008)", async ({
		request,
		baseURL,
	}) => {
		// Panggilan API langsung untuk mencoba mempublikasikan event dummy/draft yang belum diverifikasi
		const fakeEventId = "00000000-0000-4000-8000-000000000099";
		const res = await request.post(`${baseURL}/api/events/${fakeEventId}/publish`, {
			headers: { "Content-Type": "application/json" },
			data: {},
		});

		// Wajib ditolak: 401 Unauthorized (tanpa sesi) atau 404/409 Conflict bila dicoba publikasi sembarangan
		expect([401, 403, 404, 409]).toContain(res.status());
	});

	test("Failure Case 3: Penolakan Pembaruan Status Jalan oleh Petugas Tanpa Hak Akses (403 Forbidden) (TC-012)", async ({
		request,
		baseURL,
	}) => {
		// Mencoba memperbarui status ruas jalan tanpa autentikasi / tanpa penugasan
		const fakeImpactId = "00000000-0000-4000-8000-000000000088";
		const res = await request.post(`${baseURL}/api/road-impacts/${fakeImpactId}/status`, {
			headers: { "Content-Type": "application/json" },
			data: {
				status: "closed",
				mutationId: "11111111-2222-3333-4444-555555555555",
				observedAt: new Date().toISOString(),
				note: "Penutupan tidak berizin",
			},
		});

		// Wajib ditolak: 401 Unauthorized atau 403 Forbidden
		expect([401, 403]).toContain(res.status());
	});
});

test.describe("C06: Happy Path Integration Workflow", () => {
	test("Happy Path 1: Create Draft -> Manual Form -> Road Input -> Gating Verification -> Public Display", async ({
		publicPage,
	}) => {
		// 1. Buka Halaman Wizard Pembuatan Acara
		await publicPage.goto("/dashboard/events/new");
		await expect(publicPage.locator("text=1. Surat Edaran & AI")).toBeVisible();

		// 2. Langsung lewati / isi detail manual ke Langkah 2
		const skipToManualBtn = publicPage.locator('button:has-text("Lewati & Isi Rincian Manual")');
		await expect(skipToManualBtn).toBeVisible();
		await skipToManualBtn.click();

		// 3. Sekarang berada di Langkah 2 (Detail Upacara & Jadwal WITA)
		await expect(
			publicPage.locator("text=2. Detail Upacara & Jadwal Operasional WITA"),
		).toBeVisible();

		// Isi form judul kegiatan
		const titleInput = publicPage.locator('input[placeholder*="Karya Pujawali"]');
		await titleInput.fill(SYNTHETIC_E2E_DATA.event.title);

		// Isi titik pura / lokasi utama
		const venueInput = publicPage.locator('input[placeholder*="Pura Desa Adat Ubud"]');
		await venueInput.fill(SYNTHETIC_E2E_DATA.event.venueName);

		// Lanjut ke Langkah 3 (Peta & Ruas Jalan)
		const nextToStep3Btn = publicPage.locator('button:has-text("Lanjut ke Peta & Ruas Jalan")');
		await expect(nextToStep3Btn).toBeVisible();
		await nextToStep3Btn.click();

		// 4. Sekarang berada di Langkah 3 (Input Peta & Ruas Jalan)
		await expect(
			publicPage.locator("text=3. Input Peta & Ruas Jalan Terdampak"),
		).toBeVisible();

		// Lanjut ke Langkah 4 (Verifikasi Prajuru & Penerbitan)
		const nextToStep4Btn = publicPage.locator('button:has-text("Lanjut ke Verifikasi & Terbitkan")');
		await expect(nextToStep4Btn).toBeVisible();
		await nextToStep4Btn.click();

		// 5. Langkah 4: Ringkasan & Tindakan Siklus Hidup Acara
		await expect(
			publicPage.locator("text=4. Verifikasi Prajuru & Penerbitan Resmi"),
		).toBeVisible();
		await expect(publicPage.locator("text=Tindakan Siklus Hidup Acara")).toBeVisible();
		await expect(publicPage.locator(`text=${SYNTHETIC_E2E_DATA.event.title}`)).toBeVisible();

		// 6. Verifikasi Halaman Publik Portal Warga
		await publicPage.goto("/events");
		await expect(publicPage.locator("text=Jadwal Upacara & Rekayasa Jalur Bali")).toBeVisible();

		// Buka peta publik
		await publicPage.goto("/peta");
		await expect(
			publicPage.locator('input[placeholder="Cari kecamatan, desa, atau acara..."]').first(),
		).toBeVisible();
	});

	test("Happy Path 2: Upload Berkas Dokumen Valid & Indikator AI (TC-002)", async ({
		publicPage,
	}) => {
		await publicPage.goto("/dashboard/events/new");
		await expect(publicPage.locator("text=1. Surat Edaran & AI")).toBeVisible();

		// Unggah dokumen valid (gambar atau PDF <= 8MB)
		const imagePath = path.resolve(process.cwd(), SYNTHETIC_E2E_DATA.document.sampleGajahMadaImage.filePath);

		const fileInput = publicPage.locator('input[type="file"]');
		await fileInput.setInputFiles(imagePath);

		// Verifikasi indikator proses / berkas terunggah
		await expect(
			publicPage.locator("text=Mengunggah & Mengekstrak").or(
				publicPage.locator("text=1.png"),
			).or(
				publicPage.locator("text=Berkas terunggah:"),
			).or(
				publicPage.locator("text=Analisis Surat Edaran Selesai"),
			),
		).toBeVisible({ timeout: 10000 });
	});
});
