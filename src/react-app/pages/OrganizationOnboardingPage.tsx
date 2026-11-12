import {
	ArrowLeft,
	Building2,
	CheckCircle2,
	MapPin,
	ShieldAlert,
} from "lucide-react";
import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { z } from "zod";
import { ApiClientError } from "../lib/api-client";
import { useAuthSession, useCreateOrganizationMutation } from "../lib/auth";
import { useGsapPageReveal } from "../lib/gsap-motion";
import { saveOrganizationId } from "../lib/events-api";

const orgSchema = z.object({
	name: z
		.string()
		.trim()
		.min(3, "Nama organisasi/desa adat minimal 3 karakter.")
		.max(150, "Nama maksimal 150 karakter."),
	district: z.string().trim().min(1, "Pilih kabupaten/kota di Bali."),
	village: z
		.string()
		.trim()
		.min(2, "Nama desa atau kelurahan minimal 2 karakter.")
		.max(100, "Nama desa maksimal 100 karakter."),
});

const BALI_KABUPATEN_OPTIONS = [
	"Kabupaten Gianyar",
	"Kabupaten Badung",
	"Kota Denpasar",
	"Kabupaten Tabanan",
	"Kabupaten Klungkung",
	"Kabupaten Bangli",
	"Kabupaten Buleleng",
	"Kabupaten Karangasem",
	"Kabupaten Jembrana",
];

export function OrganizationOnboardingPage() {
	const navigate = useNavigate();
	const pageRef = useRef<HTMLDivElement>(null);
	const { data: sessionData, isLoading: isSessionLoading } = useAuthSession();
	const createOrgMutation = useCreateOrganizationMutation();

	const [name, setName] = useState("");
	const [district, setDistrict] = useState("Kabupaten Gianyar");
	const [village, setVillage] = useState("");
	const [fieldErrors, setFieldErrors] = useState<{
		name?: string;
		district?: string;
		village?: string;
	}>({});
	const [serverErrorMessage, setServerErrorMessage] = useState<string | null>(
		null,
	);

	useGsapPageReveal(pageRef, [isSessionLoading, Boolean(sessionData?.user)]);

	async function handleOrgSubmit(e: React.FormEvent) {
		e.preventDefault();
		setFieldErrors({});
		setServerErrorMessage(null);

		const parsed = orgSchema.safeParse({ name, district, village });
		if (!parsed.success) {
			const nextErrors: typeof fieldErrors = {};
			for (const issue of parsed.error.issues) {
				const key = issue.path[0] as keyof typeof fieldErrors;
				if (!nextErrors[key]) nextErrors[key] = issue.message;
			}
			setFieldErrors(nextErrors);
			return;
		}

		try {
			const result = await createOrgMutation.mutateAsync({
				name: parsed.data.name,
				district: parsed.data.district,
				village: parsed.data.village,
			});
			saveOrganizationId(result.organization.id);
			navigate("/dashboard");
		} catch (err) {
			if (err instanceof ApiClientError) {
				setServerErrorMessage(err.message);
			} else {
				setServerErrorMessage(
					"Gagal membuat organisasi. Pastikan Anda telah masuk akun.",
				);
			}
		}
	}

	if (!isSessionLoading && !sessionData?.user) {
		return (
			<div
				ref={pageRef}
				className="teduh-page-shell"
				style={{
					display: "flex",
					flexDirection: "column",
					alignItems: "center",
					justifyContent: "flex-start",
				}}
			>
				<div
					className="teduh-auth-card"
					data-gsap="reveal"
					style={{
						background: "#FFFFFF",
						borderRadius: 20,
						padding: "36px 32px",
						maxWidth: 440,
						textAlign: "center",
						display: "flex",
						flexDirection: "column",
						gap: 16,
					}}
				>
					<ShieldAlert size={36} color="#9E2A2B" style={{ margin: "0 auto" }} />
					<h1 style={{ margin: 0, fontSize: 22, fontWeight: 400, color: "#181B20" }}>
						Perlu Masuk Akun Terlebih Dahulu
					</h1>
					<p style={{ margin: 0, fontSize: "1rem", color: "#545B67", lineHeight: 1.6 }}>
						Untuk mendaftarkan organisasi desa adat baru, Anda harus memiliki akun terdaftar.
					</p>
					<div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 8 }}>
						<Link to="/login" className="ui-button ui-button-primary">
							<span>Masuk Akun</span>
						</Link>
						<Link to="/register" className="teduh-back-link">
							<span>Daftar Akun</span>
						</Link>
					</div>
				</div>
			</div>
		);
	}

	return (
		<div
			ref={pageRef}
			className="teduh-page-shell"
			style={{
				display: "flex",
				flexDirection: "column",
				alignItems: "center",
				justifyContent: "flex-start",
			}}
		>
			<div style={{ width: "100%", maxWidth: 520 }}>
				{/* Top back link to Dashboard */}
				<div style={{ marginBottom: 16 }} data-gsap="reveal">
					<Link
						to="/dashboard"
						className="teduh-back-link"
						style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: "1rem" }}
					>
						<ArrowLeft size={15} />
						<span>Kembali ke Panel</span>
					</Link>
				</div>

				<div
					className="teduh-auth-card"
					data-gsap="reveal"
					style={{
						background: "#FFFFFF",
						borderRadius: 20,
						padding: "36px 32px",
						boxShadow: "0 10px 30px rgba(0, 0, 0, 0.04)",
						display: "flex",
						flexDirection: "column",
						gap: 24,
					}}
				>
					<div>
						<h1
							style={{
								margin: "0 0 8px 0",
								fontSize: 26,
								fontWeight: 400,
								color: "#181B20",
								fontFamily: "var(--font-family)",
								letterSpacing: "-0.02em",
							}}
						>
							Pendaftaran Organisasi Desa Adat
						</h1>
						<p style={{ margin: 0, fontSize: "1rem", lineHeight: 1.6, color: "#545B67" }}>
							Daftarkan lembaga atau desa adat penyelenggara upacara. Sebagai pembuat pertama, Anda otomatis menjadi <strong>Organizer</strong>.
						</p>
					</div>

					{/* Information Callout */}
					<div
						style={{
							background: "#F8FAF8",
							border: "1px solid rgba(92, 132, 55, 0.12)",
							borderRadius: 14,
							padding: "12px 16px",
							fontSize: "1rem",
							lineHeight: 1.55,
							color: "#545B67",
						}}
					>
						<strong>Kewenangan Mandiri:</strong> Setelah organisasi dibuat, Anda dapat mengunggah surat keputusan upacara, memetakan penutupan jalan, serta membuat tautan undangan bagi Pecalang dan Petugas Kebersihan tanpa campur tangan superadmin.
					</div>

					{serverErrorMessage && (
						<div
							style={{
								background: "#FDF2F2",
								border: "1px solid rgba(158, 42, 43, 0.2)",
								borderRadius: 12,
								padding: "12px 14px",
								fontSize: "1rem",
								color: "#9E2A2B",
								lineHeight: 1.5,
							}}
						>
							{serverErrorMessage}
						</div>
					)}

					<form onSubmit={handleOrgSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
						{/* Org Name */}
						<div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
							<label htmlFor="org-name" style={{ fontSize: "1rem", fontWeight: 500, color: "#181B20" }}>
								Nama Desa Adat / Lembaga Penyelenggara
							</label>
							<div
								style={{
									display: "flex",
									alignItems: "center",
									background: "var(--color-surface)",
									border: fieldErrors.name
										? "1.5px solid #9E2A2B"
										: "1px solid rgba(228, 231, 229, 0.9)",
									borderRadius: 12,
									padding: "10px 14px",
									gap: 10,
								}}
							>
								<Building2 size={16} color="#64748B" style={{ flexShrink: 0 }} />
								<input
									id="org-name"
									type="text"
									value={name}
									onChange={(e) => {
										setName(e.target.value);
										if (fieldErrors.name) setFieldErrors((p) => ({ ...p, name: undefined }));
									}}
									placeholder="Contoh: Desa Adat Padangtegal"
									style={{
										border: "none",
										outline: "none",
										background: "transparent",
										width: "100%",
										fontSize: "1rem",
										color: "#181B20",
										fontFamily: "var(--font-family)",
									}}
								/>
							</div>
							{fieldErrors.name && (
								<span style={{ fontSize: "1rem", color: "#9E2A2B" }}>{fieldErrors.name}</span>
							)}
						</div>

						{/* District / Kabupaten */}
						<div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
							<label htmlFor="org-district" style={{ fontSize: "1rem", fontWeight: 500, color: "#181B20" }}>
								Kabupaten / Kota di Bali
							</label>
							<div
								style={{
									display: "flex",
									alignItems: "center",
									background: "var(--color-surface)",
									border: "1px solid rgba(228, 231, 229, 0.9)",
									borderRadius: 12,
									padding: "10px 14px",
									gap: 10,
								}}
							>
								<MapPin size={16} color="#64748B" style={{ flexShrink: 0 }} />
								<select
									id="org-district"
									value={district}
									onChange={(e) => setDistrict(e.target.value)}
									style={{
										border: "none",
										outline: "none",
										background: "transparent",
										width: "100%",
										fontSize: "1rem",
										color: "#181B20",
										fontFamily: "var(--font-family)",
									}}
								>
									{BALI_KABUPATEN_OPTIONS.map((kab) => (
										<option key={kab} value={kab}>
											{kab}
										</option>
									))}
								</select>
							</div>
						</div>

						{/* Village / Kecamatan */}
						<div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
							<label htmlFor="org-village" style={{ fontSize: "1rem", fontWeight: 500, color: "#181B20" }}>
								Kecamatan & Wilayah Desa / Banjar
							</label>
							<div
								style={{
									display: "flex",
									alignItems: "center",
									background: "var(--color-surface)",
									border: fieldErrors.village
										? "1.5px solid #9E2A2B"
										: "1px solid rgba(228, 231, 229, 0.9)",
									borderRadius: 12,
									padding: "10px 14px",
									gap: 10,
								}}
							>
								<MapPin size={16} color="#64748B" style={{ flexShrink: 0 }} />
								<input
									id="org-village"
									type="text"
									value={village}
									onChange={(e) => {
										setVillage(e.target.value);
										if (fieldErrors.village) setFieldErrors((p) => ({ ...p, village: undefined }));
									}}
									placeholder="Contoh: Ubud, Padangtegal Kelod"
									style={{
										border: "none",
										outline: "none",
										background: "transparent",
										width: "100%",
										fontSize: "1rem",
										color: "#181B20",
										fontFamily: "var(--font-family)",
									}}
								/>
							</div>
							{fieldErrors.village && (
								<span style={{ fontSize: "1rem", color: "#9E2A2B" }}>{fieldErrors.village}</span>
							)}
						</div>

						{/* Submit */}
						<button
							type="submit"
							disabled={createOrgMutation.isPending}
							style={{
								marginTop: 8,
								background: "#4D702F",
								color: "#FFFFFF",
								border: "none",
								borderRadius: 9999,
								padding: "12px 20px",
								fontSize: "1rem",
								fontWeight: 500,
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
								gap: 8,
								cursor: createOrgMutation.isPending ? "not-allowed" : "pointer",
								opacity: createOrgMutation.isPending ? 0.75 : 1,
								transition: "all var(--transition-fast)",
							}}
						>
							<CheckCircle2 size={16} />
							<span>{createOrgMutation.isPending ? "Mendaftarkan Organisasi..." : "Simpan & Lanjut ke Dashboard"}</span>
						</button>
					</form>
				</div>
			</div>
		</div>
	);
}
