import {
	ArrowLeft,
	Building2,
	CheckCircle2,
	Clock,
	Database,
	Globe,
	KeyRound,
	LogOut,
	PlusCircle,
	ShieldCheck,
	Sparkles,
	UserCheck,
} from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import {
	useAuthSession,
	useCreateOrganizationMutation,
	useMyOrganizationsQuery,
	useSignOutMutation,
} from "../lib/auth";
import {
	getSavedOrganizationId,
	saveOrganizationId,
} from "../lib/events-api";

export function SettingsPage() {
	const navigate = useNavigate();
	const { data: sessionData, isLoading: isSessionLoading } = useAuthSession();
	const myOrgsQuery = useMyOrganizationsQuery();
	const createOrgMutation = useCreateOrganizationMutation();
	const signOutMutation = useSignOutMutation();

	const myOrganizations = useMemo(
		() => myOrgsQuery.data?.organizations ?? [],
		[myOrgsQuery.data?.organizations],
	);

	const orgOptions = useMemo(() => {
		if (myOrganizations.length > 0) {
			return myOrganizations.map((org) => ({
				value: org.id,
				label: `${org.name}${org.village ? ` — ${org.village}` : ""}${
					org.district ? `, ${org.district}` : ""
				}`,
				role: org.role,
			}));
		}
		return [];
	}, [myOrganizations]);

	const [selectedOrgIdState, setSelectedOrgId] = useState(() => {
		return getSavedOrganizationId() || "";
	});
	const [saveFeedback, setSaveFeedback] = useState<string | null>(null);
	const [createError, setCreateError] = useState<string | null>(null);

	// Form state for creating a new Desa Adat
	const [newOrgName, setNewOrgName] = useState("");
	const [newOrgVillage, setNewOrgVillage] = useState("");
	const [newOrgDistrict, setNewOrgDistrict] = useState("");

	const selectedOrgId = myOrganizations.some((org) => org.id === selectedOrgIdState) ? selectedOrgIdState : "";

	function handleOrgChange(nextId: string) {
		setSelectedOrgId(nextId);
		saveOrganizationId(nextId);
		setSaveFeedback("Desa Adat aktif berhasil diperbarui untuk sesi ini.");
		setTimeout(() => setSaveFeedback(null), 3500);
	}

	async function handleCreateOrganization(e: FormEvent) {
		e.preventDefault();
		setCreateError(null);
		const trimmedName = newOrgName.trim();
		if (trimmedName.length < 3) {
			setCreateError("Nama Desa Adat / Banjar minimal 3 karakter.");
			return;
		}
		try {
			const res = await createOrgMutation.mutateAsync({
				name: trimmedName,
				village: newOrgVillage.trim() || undefined,
				district: newOrgDistrict.trim() || undefined,
			});
			const createdId = res.organization.id;
			setSelectedOrgId(createdId);
			saveOrganizationId(createdId);
			setNewOrgName("");
			setNewOrgVillage("");
			setNewOrgDistrict("");
			setSaveFeedback(
				`Desa Adat "${res.organization.name}" berhasil didaftarkan dan diaktifkan.`,
			);
		} catch (err) {
			setCreateError(
				err instanceof Error
					? err.message
					: "Gagal mendaftarkan Desa Adat baru.",
			);
		}
	}

	const activeOrgOption =
		orgOptions.find((o) => o.value === selectedOrgId);

	return (
		<div>
			{/* Header */}
			<div className="teduh-workspace-header">
				<div>
					<div className="teduh-workspace-eyebrow">
						<ShieldCheck className="w-3.5 h-3.5" />
						<span>Konfigurasi Akun, Peran &amp; Desa Adat</span>
					</div>
					<h1 className="teduh-workspace-title">
						Pengaturan Akun &amp; Desa Adat
					</h1>
					<p className="teduh-workspace-subtitle">
						Kelola identitas petugas, keanggotaan Desa Adat / Banjar, hak akses
						peran (Panitia vs Pecalang), serta parameter operasional sistem.
					</p>
				</div>

				<div className="flex flex-wrap items-center gap-2">
					<Link
						to="/dashboard"
						className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[#E5E3DC] bg-white text-xs font-semibold text-[#181817] hover:bg-[#F3F1EC] no-underline"
					>
						<ArrowLeft className="w-3.5 h-3.5" />
						<span>Kembali ke Dashboard</span>
					</Link>
				</div>
			</div>

			{saveFeedback ? (
				<div className="mb-6 rounded-2xl border border-[#A6D9B8] bg-[#EBF7F0] p-4 flex items-center gap-2.5 text-xs font-semibold text-[#1D5E3A]">
					<CheckCircle2 className="w-4 h-4 shrink-0" />
					<span>{saveFeedback}</span>
				</div>
			) : null}

			<div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
				{/* Left Column: Account & Organization Management */}
				<div className="xl:col-span-7 space-y-6">
					{/* 1. Profil Pengguna */}
					<div className="teduh-workspace-card space-y-4">
						<div className="flex items-center justify-between gap-2 border-b border-[#F0EFEA] pb-3">
							<div className="flex items-center gap-2">
								<UserCheck className="w-4 h-4 text-[#264D3B]" />
								<h2 className="teduh-workspace-card-title">
									Profil Petugas &amp; Sesi Otentikasi
								</h2>
							</div>
							<span
								className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider ${
									sessionData?.user
										? "bg-[#EBF3EE] text-[#264D3B]"
										: "bg-[#F3F1EC] text-[#585854]"
								}`}
							>
								{sessionData?.user ? "Sesi Aktif" : "Mode Tamu"}
							</span>
						</div>

						{!isSessionLoading && sessionData?.user ? (
							<div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
								<div className="rounded-xl border border-[#E5E3DC] bg-[#FBFBFA] p-3 space-y-1">
									<span className="text-[11px] font-semibold uppercase tracking-wider text-[#585854]">
										Nama Lengkap Petugas
									</span>
									<p className="text-sm font-bold text-[#181817]">
										{sessionData.user.name || "Prajuru Desa Adat"}
									</p>
								</div>
								<div className="rounded-xl border border-[#E5E3DC] bg-[#FBFBFA] p-3 space-y-1">
									<span className="text-[11px] font-semibold uppercase tracking-wider text-[#585854]">
										Alamat Surel Resmi
									</span>
									<p className="text-sm font-bold text-[#181817]">
										{sessionData.user.email}
									</p>
								</div>
								<div className="rounded-xl border border-[#E5E3DC] bg-[#FBFBFA] p-3 space-y-1">
									<span className="text-[11px] font-semibold uppercase tracking-wider text-[#585854]">
										ID Akun Sistem
									</span>
									<p className="text-xs font-mono text-[#585854] break-all">
										{sessionData.user.id}
									</p>
								</div>
								<div className="rounded-xl border border-[#E5E3DC] bg-[#FBFBFA] p-3 space-y-1">
									<span className="text-[11px] font-semibold uppercase tracking-wider text-[#585854]">
										Peran Aktif di Desa Terpilih
									</span>
									<p className="text-sm font-bold text-[#264D3B]">
										{activeOrgOption?.role === "officer"
											? "Petugas Lapangan (Pecalang / Kebersihan)"
											: activeOrgOption?.role === "organizer" ? "Panitia Penyelenggara (Organizer)" : "Pilih organisasi"}
									</p>
								</div>
							</div>
						) : (
							<div className="rounded-xl border border-[#E5E3DC] bg-[#FBFBFA] p-4 space-y-2 text-xs text-[#585854]">
								<p className="font-semibold text-[#181817]">
									Anda belum masuk ke akun petugas.
								</p>
								<p>
									Masuk atau daftarkan akun resmi untuk membuat pengumuman
									upacara, mengunggah surat edaran ke Cloudflare R2, dan
									memperbarui status ruas jalan secara sah.
								</p>
							</div>
						)}

						<div className="flex flex-wrap items-center justify-end gap-2 pt-2">
							{!isSessionLoading && sessionData?.user ? (
								<button
									type="button"
									disabled={signOutMutation.isPending}
									onClick={() => {
										signOutMutation.mutate(undefined, {
											onSuccess: () => navigate("/login"),
										});
									}}
									className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-[#E8B4B4] bg-[#FDF2F2] text-xs font-semibold text-[#9E2A2B] hover:bg-[#fae5e5] transition-colors"
								>
									<LogOut className="w-3.5 h-3.5" />
									<span>
										{signOutMutation.isPending
											? "Mengeluarkan Sesi..."
											: "Keluar dari Akun"}
									</span>
								</button>
							) : (
								<div className="flex items-center gap-2">
									<Link
										to="/login"
										className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#264D3B] text-xs font-semibold text-white hover:bg-[#1d3c2e] no-underline"
									>
										<KeyRound className="w-3.5 h-3.5" />
										<span>Masuk Akun Petugas</span>
									</Link>
									<Link
										to="/register"
										className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-[#E5E3DC] bg-white text-xs font-semibold text-[#181817] hover:bg-[#F3F1EC] no-underline"
									>
										<span>Daftar Akun Baru</span>
									</Link>
								</div>
							)}
						</div>
					</div>

					{/* 2. Pemilihan & Pendaftaran Desa Adat */}
					<div className="teduh-workspace-card space-y-4">
						<div className="flex items-center justify-between gap-2 border-b border-[#F0EFEA] pb-3">
							<div className="flex items-center gap-2">
								<Building2 className="w-4 h-4 text-[#264D3B]" />
								<h2 className="teduh-workspace-card-title">
									Desa Adat &amp; Organisasi Kerja
								</h2>
							</div>
							<span className="text-xs font-semibold text-[#585854]">
								{myOrganizations.length} Desa Terhubung
							</span>
						</div>

						<div className="space-y-2">
							<label
								htmlFor="active-desa-select"
								className="block text-xs font-semibold text-[#181817]"
							>
								Pilih Desa Adat Aktif (Digunakan saat Membuat Draf Baru)
							</label>
							<select
								id="active-desa-select"
								value={selectedOrgId}
								onChange={(e) => handleOrgChange(e.target.value)}
								className="w-full rounded-xl border border-[#E5E3DC] bg-[#FBFBFA] px-3.5 py-2.5 text-xs font-medium text-[#181817] focus:outline-none focus:border-[#264D3B]"
							>
								<option value="">Pilih organisasi</option>
								{orgOptions.map((opt) => (
									<option key={opt.value} value={opt.value}>
										{opt.label} (
										{opt.role === "officer" ? "Petugas Lapangan" : "Panitia"})
									</option>
								))}
							</select>
							<p className="text-[11px] text-[#585854]">
								UUID Organisasi Aktif:{" "}
								<span className="font-mono">{selectedOrgId}</span>
							</p>
						</div>

						{/* Daftar Keanggotaan Desa Adat */}
						{myOrganizations.length > 0 ? (
							<div className="space-y-2 pt-2">
								<span className="block text-xs font-semibold text-[#181817]">
									Daftar Keanggotaan Desa Adat Anda
								</span>
								<div className="space-y-2">
									{myOrganizations.map((org) => {
										const isCurrent = org.id === selectedOrgId;
										return (
											<div
												key={org.id}
												className={`rounded-xl border p-3 flex items-center justify-between gap-3 ${
													isCurrent
														? "border-[#264D3B] bg-[#EBF3EE]/50"
														: "border-[#E5E3DC] bg-[#FBFBFA]"
												}`}
											>
												<div className="min-w-0">
													<p className="text-xs font-bold text-[#181817] truncate">
														{org.name}
													</p>
													<p className="text-[11px] text-[#585854]">
														{org.village || "Bali"}
														{org.district ? `, Kec. ${org.district}` : ""} •
														Peran:{" "}
														<span className="font-semibold text-[#264D3B]">
															{org.role === "organizer"
																? "Panitia (Organizer)"
																: "Petugas Lapangan (Officer)"}
														</span>
													</p>
												</div>
												{isCurrent ? (
													<span className="px-2.5 py-1 rounded-lg bg-[#264D3B] text-white text-[11px] font-semibold shrink-0">
														Aktif Digunakan
													</span>
												) : (
													<button
														type="button"
														onClick={() => handleOrgChange(org.id)}
														className="px-3 py-1 rounded-lg border border-[#E5E3DC] bg-white text-[11px] font-semibold text-[#181817] hover:bg-[#F3F1EC] shrink-0"
													>
														Jadikan Aktif
													</button>
												)}
											</div>
										);
									})}
								</div>
							</div>
						) : null}

						{/* Form Tambah Desa Adat Baru */}
						{sessionData?.user ? (
							<form
								onSubmit={(e) => void handleCreateOrganization(e)}
								className="pt-4 border-t border-[#F0EFEA] space-y-3"
							>
								<div className="flex items-center gap-1.5">
									<PlusCircle className="w-3.5 h-3.5 text-[#264D3B]" />
									<span className="text-xs font-bold text-[#181817]">
										Daftarkan Desa Adat / Banjar Baru
									</span>
								</div>

								{createError ? (
									<div className="rounded-xl border border-[#E8B4B4] bg-[#FDF2F2] p-3 text-xs text-[#9E2A2B]">
										{createError}
									</div>
								) : null}

								<div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
									<div>
										<label className="block text-[11px] font-semibold text-[#585854] mb-1">
											Nama Desa Adat / Banjar *
										</label>
										<input
											type="text"
											required
											value={newOrgName}
											onChange={(e) => setNewOrgName(e.target.value)}
											placeholder="Mis. Desa Adat Kedewatan"
											className="w-full rounded-xl border border-[#E5E3DC] bg-[#FBFBFA] px-3 py-2 text-xs text-[#181817]"
										/>
									</div>
									<div>
										<label className="block text-[11px] font-semibold text-[#585854] mb-1">
											Kelurahan / Desa
										</label>
										<input
											type="text"
											value={newOrgVillage}
											onChange={(e) => setNewOrgVillage(e.target.value)}
											placeholder="Mis. Kedewatan"
											className="w-full rounded-xl border border-[#E5E3DC] bg-[#FBFBFA] px-3 py-2 text-xs text-[#181817]"
										/>
									</div>
									<div>
										<label className="block text-[11px] font-semibold text-[#585854] mb-1">
											Kecamatan / Kabupaten
										</label>
										<input
											type="text"
											value={newOrgDistrict}
											onChange={(e) => setNewOrgDistrict(e.target.value)}
											placeholder="Mis. Ubud, Gianyar"
											className="w-full rounded-xl border border-[#E5E3DC] bg-[#FBFBFA] px-3 py-2 text-xs text-[#181817]"
										/>
									</div>
								</div>

								<div className="flex justify-end">
									<button
										type="submit"
										disabled={createOrgMutation.isPending}
										className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#264D3B] text-white text-xs font-semibold hover:bg-[#1d3c2e] disabled:opacity-50"
									>
										<PlusCircle className="w-3.5 h-3.5" />
										<span>
											{createOrgMutation.isPending
												? "Mendaftarkan Desa Adat..."
												: "Tambah & Aktifkan Desa Adat"}
										</span>
									</button>
								</div>
							</form>
						) : null}
					</div>
				</div>

				{/* Right Column: Operational Standards & System Architecture */}
				<div className="xl:col-span-5 space-y-6">
					<div className="teduh-workspace-card space-y-4">
						<h2 className="teduh-workspace-card-title">
							Standar Operasional &amp; Integrasi Sistem
						</h2>
						<div className="space-y-3 text-xs">
							<div className="rounded-xl border border-[#E5E3DC] bg-[#FBFBFA] p-3 flex items-start gap-3">
								<Clock className="w-4 h-4 text-[#264D3B] shrink-0 mt-0.5" />
								<div>
									<p className="font-bold text-[#181817]">
										Zona Waktu Operasional WITA
									</p>
									<p className="text-[#585854]">
										Seluruh jadwal kegiatan dan masa berlaku laporan Pecalang
										ditampilkan dalam Asia/Makassar (UTC+8).
									</p>
								</div>
							</div>

							<div className="rounded-xl border border-[#E5E3DC] bg-[#FBFBFA] p-3 flex items-start gap-3">
								<Database className="w-4 h-4 text-[#264D3B] shrink-0 mt-0.5" />
								<div>
									<p className="font-bold text-[#181817]">
										Neon PostgreSQL + PostGIS
									</p>
									<p className="text-[#585854]">
										Geometri ruas jalan disimpan sebagai LineString terverifikasi
										dan riwayat pembaruan jalan bersifat append-only.
									</p>
								</div>
							</div>

							<div className="rounded-xl border border-[#E5E3DC] bg-[#FBFBFA] p-3 flex items-start gap-3">
								<Sparkles className="w-4 h-4 text-[#264D3B] shrink-0 mt-0.5" />
								<div>
									<p className="font-bold text-[#181817]">
										Ekstraksi AI Multimodal Terkendali
									</p>
									<p className="text-[#585854]">
										Google Gemini mengekstrak draf surat edaran menjadi JSON
										terstruktur. Hasil AI tidak pernah diterbitkan otomatis
										tanpa verifikasi panitia.
									</p>
								</div>
							</div>

							<div className="rounded-xl border border-[#E5E3DC] bg-[#FBFBFA] p-3 flex items-start gap-3">
								<Globe className="w-4 h-4 text-[#264D3B] shrink-0 mt-0.5" />
								<div>
									<p className="font-bold text-[#181817]">
										Cloudflare R2 Private Storage
									</p>
									<p className="text-[#585854]">
										Dokumen surat edaran asli dan foto bukti kebersihan disimpan
										secara privat dan tidak diekspos ke endpoint publik.
									</p>
								</div>
							</div>
						</div>

						<div className="rounded-xl border border-[#D7E3DC] bg-[#EBF3EE] p-3.5 text-xs text-[#264D3B] space-y-1">
							<p className="font-bold">Batasan Hukum &amp; Wewenang Rangkai</p>
							<p className="leading-relaxed">
								Rangkai adalah sistem koordinasi operasional upacara adat dan
								bukan izin penutupan jalan resmi kepolisian/Dishub. Penyelesaian
								kebersihan tidak pernah membuka kembali ruas jalan secara
								otomatis tanpa pembaruan dari petugas lapangan berwenang.
							</p>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
