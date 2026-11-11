import { AlertDialog } from "@astryxdesign/core/AlertDialog";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Divider } from "@astryxdesign/core/Divider";
import { FileInput } from "@astryxdesign/core/FileInput";
import { FormLayout } from "@astryxdesign/core/FormLayout";
import { Grid } from "@astryxdesign/core/Grid";
import { Heading } from "@astryxdesign/core/Heading";
import { Icon } from "@astryxdesign/core/Icon";
import { Selector } from "@astryxdesign/core/Selector";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Step, Stepper } from "@astryxdesign/core/Stepper";
import { Text } from "@astryxdesign/core/Text";
import { TextArea } from "@astryxdesign/core/TextArea";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useToast } from "@astryxdesign/core/Toast";
import { Token } from "@astryxdesign/core/Token";
import {
	Layers,
	MapPinned,
	RefreshCw,
	ShieldAlert,
	Sparkles,
} from "lucide-react";
import { useState } from "react";
import {
	CleanupStatusBadge,
	EmptyStateCard,
	ErrorStateBanner,
	EventLifecycleBadge,
	FieldReviewIndicator,
	LastUpdatedWita,
	LoadingStateBlock,
	MapFallbackRoadList,
	RoadStatusBadge,
	StaleStatusNotice,
	WasteMeasurementBadge,
	type CleanupTaskStatus,
	type FieldReviewState,
	type OperationalRoadStatus,
	type RoadSegmentFallbackItem,
} from "../components/rangkai";
import { ApiClientError, type EventLifecycleStatus } from "../lib/api-client";
import { OPERATIONAL_DISCLAIMERS, UX_EMPTY_COPY } from "../lib/constants";

const DEMO_ACTIVE_EXPIRY_ISO = "2099-11-05T12:00:00Z";
const DEMO_STALE_OBSERVED_ISO = "2026-11-03T07:00:00Z";
const DEMO_STALE_EXPIRY_ISO = "2026-11-03T07:30:00Z";

const SAMPLE_SEGMENTS: RoadSegmentFallbackItem[] = [
	{
		id: "seg-1",
		segmentName: "Jl. Raya Ubud (Simpang Puri – Pasar Seni)",
		corridorArea: "Kecamatan Ubud, Gianyar",
		impactType: "closure",
		plannedFrom: "2026-11-05T07:00:00Z",
		plannedTo: "2026-11-05T11:00:00Z",
		status: "closed",
		observedAt: "2026-11-04T06:00:00Z",
		expiresAt: DEMO_ACTIVE_EXPIRY_ISO,
		diversionNote:
			"Kendaraan roda empat dialihkan melalui Jl. Sri Wedari atau Jl. Tirta Tawar.",
	},
	{
		id: "seg-2",
		segmentName: "Jl. Monkey Forest (Utara – Simpang Padangtegal)",
		corridorArea: "Kecamatan Ubud, Gianyar",
		impactType: "intermittent_flow",
		plannedFrom: "2026-11-05T07:30:00Z",
		plannedTo: "2026-11-05T11:30:00Z",
		status: "intermittent",
		observedAt: DEMO_STALE_OBSERVED_ISO,
		expiresAt: DEMO_STALE_EXPIRY_ISO,
		diversionNote:
			"Diatur buka-tutup oleh Pecalang Desa Adat Padangtegal saat iring-iringan melintas.",
	},
	{
		id: "seg-3",
		segmentName: "Jl. Hanoman (Simpang Bebek Bengil)",
		corridorArea: "Kecamatan Ubud, Gianyar",
		impactType: "parking_restriction",
		plannedFrom: "2026-11-05T06:00:00Z",
		plannedTo: "2026-11-05T13:00:00Z",
		status: "open",
		observedAt: "2026-11-04T06:10:00Z",
		expiresAt: DEMO_ACTIVE_EXPIRY_ISO,
		diversionNote: null,
	},
];

/**
 * Interactive UI Component Catalog (`/ui-system`)
 *
 * Ensures every Rangkai page (B01–B10) consumes the exact same Astryx + Rangkai
 * domain components with verified states, accessibility, and honest status rules.
 */
export function UiSystemCatalogPage() {
	const showToast = useToast();
	const [wizardStep, setWizardStep] = useState(0);
	const [titleInput, setTitleInput] = useState("Karya Agung Pura Desa Ubud");
	const [venueInput, setVenueInput] = useState("");
	const [selectedCategory, setSelectedCategory] = useState("upacara");
	const [notesInput, setNotesInput] = useState(
		"Mohon warga sekitar mengantisipasi pengalihan arus selama prosesi melasti.",
	);
	const [uploadedFile, setUploadedFile] = useState<File | File[] | null>(null);
	const [isConfirmDialogOpen, setIsConfirmDialogOpen] = useState(false);
	const [pendingOfficerStatus, setPendingOfficerStatus] =
		useState<OperationalRoadStatus>("closed");

	const roadStatuses: OperationalRoadStatus[] = [
		"open",
		"intermittent",
		"closed",
		"unknown",
	];
	const aiStates: FieldReviewState[] = [
		"extracted",
		"missing",
		"needs_review",
		"corrected",
		"confirmed",
	];
	const lifecycleStates: EventLifecycleStatus[] = [
		"draft",
		"review",
		"published",
		"active",
		"completed",
		"cancelled",
	];
	const cleanupStates: CleanupTaskStatus[] = [
		"todo",
		"in_progress",
		"submitted",
		"verified",
		"reopened",
	];

	return (
		<VStack gap={8} paddingBlockEnd={10}>
			<Card padding={6}>
				<VStack gap={3}>
					<HStack justify="between" vAlign="center" wrap="wrap" gap={2}>
						<HStack gap={2} vAlign="center">
							<Icon icon={Layers} size="md" color="accent" />
							<Token
								color="teal"
								size="sm"
								label="Astryx Design System (@astryxdesign/core + theme-stone)"
							/>
						</HStack>
						<LastUpdatedWita
							timestamp={DEMO_STALE_OBSERVED_ISO}
							labelPrefix="Contoh waktu WITA"
							showRelative={false}
						/>
					</HStack>
					<Heading level={1}>
						Katalog Komponen UI & Standar Visual Rangkai
					</Heading>
					<Text size="base" color="secondary">
						Seluruh halaman aplikasi Rangkai (B01–B10) wajib menggunakan komponen
						terstandar di bawah ini agar tampilan tetap konsisten, aksesibel
						(WCAG 2.2 AA), dan mematuhi prinsip Pramana (status jujur, tanpa
						placeholder palsu, waktu selalu dalam WITA).
					</Text>
				</VStack>
			</Card>

			{/* Section 1: Road Operational Statuses & Stale Handling */}
			<Card padding={6}>
				<VStack gap={5}>
					<VStack gap={1}>
						<Heading level={2}>
							1. Status Operasional Ruas Jalan & Penanganan Status Kedaluwarsa
						</Heading>
						<Text size="sm" color="secondary">
							Komponen RoadStatusBadge dan StaleStatusNotice (SRS FR-034, FR-037,
							FR-038, AC-04). Status kedaluwarsa tidak pernah diubah diam-diam
							menjadi OPEN.
						</Text>
					</VStack>

					<VStack gap={3}>
						<Text size="sm" weight="semibold">
							Status Aktif Terkonfirmasi:
						</Text>
						<HStack gap={4} wrap="wrap" vAlign="center">
							{roadStatuses.map((status) => (
								<RoadStatusBadge
									key={status}
									status={status}
									expiresAt={DEMO_ACTIVE_EXPIRY_ISO}
									showCongestionHint={status === "open"}
								/>
							))}
						</HStack>
					</VStack>

					<Divider variant="subtle" />

					<VStack gap={3}>
						<Text size="sm" weight="semibold">
							Status Kedaluwarsa (Expired &rarr; Unconfirmed):
						</Text>
						<RoadStatusBadge
							status="closed"
							expiresAt={DEMO_STALE_EXPIRY_ISO}
						/>
						<StaleStatusNotice
							lastKnownStatus="closed"
							observedAt={DEMO_STALE_OBSERVED_ISO}
							expiresAt={DEMO_STALE_EXPIRY_ISO}
						/>
					</VStack>
				</VStack>
			</Card>

			{/* Section 2: AI Review Field Indicators & Event/Cleanup Lifecycles */}
			<Card padding={6}>
				<VStack gap={5}>
					<VStack gap={1}>
						<Heading level={2}>
							2. Indikator Tinjauan AI, Siklus Acara, Kebersihan, & Sampah
						</Heading>
						<Text size="sm" color="secondary">
							Komponen FieldReviewIndicator, EventLifecycleBadge,
							CleanupStatusBadge, dan WasteMeasurementBadge (UX-FLOW §3.E,
							AGENTS §13).
						</Text>
					</VStack>

					<VStack gap={2}>
						<Text size="sm" weight="semibold">
							Status Kolom Ekstraksi AI (Human-in-the-Loop):
						</Text>
						<HStack gap={2} wrap="wrap">
							{aiStates.map((st) => (
								<FieldReviewIndicator key={st} state={st} />
							))}
						</HStack>
					</VStack>

					<Divider variant="subtle" />

					<VStack gap={2}>
						<Text size="sm" weight="semibold">
							Siklus Hidup Kegiatan (DRAFT &rarr; REVIEW &rarr; PUBLISHED &rarr;
							ACTIVE &rarr; COMPLETED):
						</Text>
						<HStack gap={2} wrap="wrap">
							{lifecycleStates.map((st) => (
								<EventLifecycleBadge key={st} status={st} />
							))}
						</HStack>
					</VStack>

					<Divider variant="subtle" />

					<VStack gap={2}>
						<Text size="sm" weight="semibold">
							Status Tugas Kebersihan (Independen dari Pembukaan Jalan):
						</Text>
						<HStack gap={2} wrap="wrap">
							{cleanupStates.map((st) => (
								<CleanupStatusBadge key={st} status={st} />
							))}
						</HStack>
					</VStack>

					<Divider variant="subtle" />

					<VStack gap={2}>
						<Text size="sm" weight="semibold">
							Catatan Kuantitas Sampah (Membedakan Berat Tertimbang vs Estimasi vs
							Karung):
						</Text>
						<VStack gap={2}>
							<WasteMeasurementBadge
								category="organic"
								method="weighed"
								quantity={42.5}
								unit="kg"
							/>
							<WasteMeasurementBadge
								category="recyclable"
								method="estimated"
								quantity={18}
								unit="kg"
							/>
							<WasteMeasurementBadge
								category="residual"
								method="sack_count"
								quantity={7}
								unit="karung"
							/>
						</VStack>
					</VStack>
				</VStack>
			</Card>

			{/* Section 3: Wizard Stepper & FormLayout */}
			<Card padding={6}>
				<VStack gap={5}>
					<VStack gap={1}>
						<Heading level={2}>
							3. Alur Bertahap (Stepper Wizard) & FormLayout Tervalidasi
						</Heading>
						<Text size="sm" color="secondary">
							Digunakan pada halaman Buat Kegiatan (7 langkah UX-FLOW §3.D),
							menggunakan komponen resmi FormLayout, TextInput, Selector,
							FileInput, dan TextArea.
						</Text>
					</VStack>

					<Stepper
						activeStep={wizardStep}
						onStepClick={setWizardStep}
						label="Tahapan Pembuatan Kegiatan"
					>
						<Step step={0} label="1. Detail Dasar" status="success" />
						<Step step={1} label="2. Unggah Dokumen" />
						<Step step={2} label="3. Ekstraksi AI" />
						<Step step={3} label="4. Tinjau & Koreksi" />
						<Step step={4} label="5. Pilih Ruas Jalan" />
						<Step step={5} label="6. Tugas Kebersihan" />
						<Step step={6} label="7. Publikasi" />
					</Stepper>

					<Divider variant="subtle" />

					<FormLayout direction="vertical" defaultOptionality="required">
						<FormLayout direction="horizontal">
							<TextInput
								label="Nama Kegiatan Budaya"
								isRequired
								value={titleInput}
								onChange={(val) => setTitleInput(val)}
								description="Sesuai surat pengumuman resmi banjar atau desa adat."
								status={
									titleInput.trim().length > 3
										? {
												type: "success",
												message: "Nama kegiatan terkonfirmasi panitia.",
											}
										: {
												type: "error",
												message: "Nama kegiatan wajib diisi minimal 4 karakter.",
											}
								}
							/>

							<TextInput
								label="Lokasi / Balai Banjar Utama"
								isRequired
								value={venueInput}
								onChange={(val) => setVenueInput(val)}
								placeholder="Contoh: Pura Dalem Ubud"
								status={
									venueInput.trim().length === 0
										? {
												type: "warning",
												message:
													"Kolom ini tidak ditemukan di dokumen AI. Mohon isi secara manual.",
											}
										: undefined
								}
							/>
						</FormLayout>

						<FormLayout direction="horizontal">
							<Selector
								label="Kategori Kegiatan"
								isRequired
								value={selectedCategory}
								onChange={(val) => setSelectedCategory(val)}
								options={[
									{ value: "upacara", label: "Upacara Adat / Yadnya" },
									{ value: "prosesi", label: "Prosesi / Melasti / Ngaben" },
									{ value: "budaya", label: "Pawai / Festival Budaya" },
								]}
							/>

							<FileInput
								label="Unggah Surat / Poster Pengumuman (PDF, JPG, PNG maks. 8 MB)"
								isOptional
								accept=".pdf,.jpg,.jpeg,.png"
								maxSize={8 * 1024 * 1024}
								value={uploadedFile}
								onChange={(files) => setUploadedFile(files)}
								description="Dokumen disimpan privat di R2 dan tidak pernah dipublikasikan."
							/>
						</FormLayout>

						<TextArea
							label="Catatan Panduan Masyarakat"
							isOptional
							value={notesInput}
							onChange={(val) => setNotesInput(val)}
							rows={3}
							description="Ditampilkan pada halaman publik kegiatan setelah diverifikasi."
						/>
					</FormLayout>

					<HStack justify="between" vAlign="center" wrap="wrap" gap={3}>
						<HStack gap={2} wrap="wrap">
							<Button
								variant="secondary"
								label="Simpan sebagai Draf"
								onClick={() =>
									showToast({
										type: "info",
										body: "Draf kegiatan disimpan. Anda dapat melanjutkan pengisian kapan saja.",
									})
								}
							/>
							<Button
								variant="primary"
								icon={<Icon icon={Sparkles} size="sm" />}
								label="Lanjut ke Tahap Berikutnya"
								onClick={() => setWizardStep((prev) => (prev + 1) % 7)}
							/>
						</HStack>

						<Button
							variant="secondary"
							icon={<Icon icon={ShieldAlert} size="sm" />}
							label="Simulasi Dialog Konfirmasi Petugas"
							onClick={() => {
								setPendingOfficerStatus("closed");
								setIsConfirmDialogOpen(true);
							}}
						/>
					</HStack>
				</VStack>
			</Card>

			{/* Section 4: Map Fallback Road List (using Astryx List + ListItem) */}
			<VStack gap={3}>
				<HStack gap={2} vAlign="center">
					<Icon icon={MapPinned} size="md" color="secondary" />
					<Heading level={2}>
						4. Daftar Ruas Jalan Terdampak (Astryx List & ListItem — Bukan
						Card-per-Row)
					</Heading>
				</HStack>
				<Text size="sm" color="secondary">
					Menjamin aksesibilitas penuh apabila tile peta gagal dimuat atau
					pengguna membaca melalui perangkat pembaca layar (UX-FLOW §3.B,
					NFR-011).
				</Text>

				<MapFallbackRoadList
					segments={SAMPLE_SEGMENTS}
					showMapUnavailableNotice
				/>
			</VStack>

			{/* Section 5: Async Loading, Error, and Empty States */}
			<Card padding={6}>
				<VStack gap={5}>
					<VStack gap={1}>
						<Heading level={2}>
							5. Standar Status Asinkron (Loading, Error, Empty, & Fallback)
						</Heading>
						<Text size="sm" color="secondary">
							Setiap pemanggilan API di Rangkai wajib menampilkan status yang
							jujur beserta langkah pemulihan (UX-FLOW §7, AGENTS §18).
						</Text>
					</VStack>

					<LoadingStateBlock
						label="Mengekstrak kandidat informasi dari dokumen pengumuman..."
						rows={3}
					/>

					<ErrorStateBanner
						title={UX_EMPTY_COPY.AI_UNAVAILABLE}
						error={
							new ApiClientError(503, {
								code: "AI_PROVIDER_UNAVAILABLE",
								message: OPERATIONAL_DISCLAIMERS.AI_REVIEW_REQUIRED,
								requestId: "req_demo_ai_fallback",
							})
						}
						onRetry={() =>
							showToast({
								type: "info",
								body: "Mencoba kembali permintaan ke server...",
							})
						}
						fallbackAction={
							<Button
								variant="primary"
								size="sm"
								label="Isi Data Secara Manual"
								onClick={() =>
									showToast({
										type: "info",
										body: "Beralih ke formulir input manual panitia.",
									})
								}
							/>
						}
					/>

					<Grid columns={{ minWidth: 280, max: 2 }} gap={4}>
						<EmptyStateCard
							title={UX_EMPTY_COPY.NO_PUBLISHED_EVENTS}
							description="Kegiatan hanya ditampilkan di halaman publik setelah panitia menyelesaikan tinjauan dan verifikasi ruas jalan."
							actions={
								<Button
									variant="secondary"
									size="sm"
									icon={<Icon icon={RefreshCw} size="sm" />}
									label="Muat Ulang Direktori"
									onClick={() =>
										showToast({
											type: "info",
											body: "Memeriksa pembaruan daftar kegiatan publik...",
										})
									}
								/>
							}
						/>

						<EmptyStateCard
							title={UX_EMPTY_COPY.UPLOAD_FAILED}
							description="Format yang didukung: PDF, JPEG, atau PNG (maksimal 8 MB). Anda tetap dapat mengisi formulir secara manual."
							actions={
								<Button
									variant="primary"
									size="sm"
									icon={<Icon icon="upload" size="sm" />}
									label="Coba Unggah Kembali"
									onClick={() =>
										showToast({
											type: "info",
											body: "Silakan pilih berkas dokumen pengumuman kembali.",
										})
									}
								/>
							}
						/>
					</Grid>

					<Banner
						status="info"
						collapsible={false}
						title="Independensi Kebersihan & Lalu Lintas (AGENTS.md §13)"
						description={OPERATIONAL_DISCLAIMERS.CLEANUP_INDEPENDENCE_NOTE}
					/>
				</VStack>
			</Card>

			<AlertDialog
				isOpen={isConfirmDialogOpen}
				onOpenChange={setIsConfirmDialogOpen}
				title="Konfirmasi Pembaruan Status Ruas Jalan"
				description={`Anda akan mengirimkan status "${pendingOfficerStatus.toUpperCase()}" untuk Jl. Raya Ubud ke server. Perubahan baru ditampilkan ke publik setelah server mengonfirmasi penyimpanan dan mencatat audit log.`}
				cancelLabel="Batal"
				actionLabel="Kirim Pembaruan ke Server"
				actionVariant="destructive"
				onAction={() => {
					setIsConfirmDialogOpen(false);
					showToast({
						type: "info",
						body: "Konfirmasi server diterima: Status ruas jalan diperbarui (WITA).",
						endContent: <Icon icon="success" size="sm" color="success" />,
					});
				}}
			/>
		</VStack>
	);
}
