import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	AlertCircle,
	Check,
	CheckCircle2,
	Loader2,
	MapPin,
	Plus,
	Trash2,
	XCircle,
} from "lucide-react";
import { useState } from "react";
import {
	approveAlternativeRoute,
	createAlternativeRoute,
	deleteAlternativeRoute,
	fetchAlternativeRoutes,
	fetchPublicAlternativeRoutes,
	revokeAlternativeRoute,
} from "../../lib/events-api";

// ---------------------------------------------------------------------------
// Organizer Alternative Routes Manager (Ticket 06)
// ---------------------------------------------------------------------------
export function OrganizerAlternativeRoutesManager({
	eventId,
	isOrganizer,
}: {
	eventId: string;
	isOrganizer: boolean;
}) {
	const queryClient = useQueryClient();
	const [isAdding, setIsAdding] = useState(false);
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [coordinatesInput, setCoordinatesInput] = useState(
		"115.258, -8.691\n115.260, -8.695\n115.262, -8.700",
	);
	const [formError, setFormError] = useState<string | null>(null);
	const [feedbackMsg, setFeedbackMsg] = useState<{
		type: "success" | "error";
		text: string;
	} | null>(null);

	const routesQuery = useQuery({
		queryKey: ["events", eventId, "alternative-routes"],
		queryFn: () => fetchAlternativeRoutes(eventId),
		enabled: Boolean(eventId),
	});

	const createMutation = useMutation({
		mutationFn: (coords: [number, number][]) =>
			createAlternativeRoute(eventId, {
				name,
				description: description.trim() || undefined,
				coordinates: coords,
			}),
		onSuccess: () => {
			setFeedbackMsg({
				type: "success",
				text: "Rute alternatif berhasil disimpan sebagai draf.",
			});
			setIsAdding(false);
			setName("");
			setDescription("");
			queryClient.invalidateQueries({
				queryKey: ["events", eventId, "alternative-routes"],
			});
		},
		onError: (err: Error) => {
			setFormError(err.message || "Gagal membuat rute alternatif.");
		},
	});

	const approveMutation = useMutation({
		mutationFn: (routeId: string) => approveAlternativeRoute(eventId, routeId),
		onSuccess: () => {
			setFeedbackMsg({
				type: "success",
				text: "Rute alternatif telah disetujui dan dapat dilihat warga di peta publik.",
			});
			queryClient.invalidateQueries({
				queryKey: ["events", eventId, "alternative-routes"],
			});
		},
		onError: (err: Error) => {
			setFeedbackMsg({
				type: "error",
				text: err.message || "Gagal menyetujui rute alternatif.",
			});
		},
	});

	const revokeMutation = useMutation({
		mutationFn: (routeId: string) => revokeAlternativeRoute(eventId, routeId),
		onSuccess: () => {
			setFeedbackMsg({
				type: "success",
				text: "Rute alternatif telah dicabut dan tidak lagi tampil di peta publik.",
			});
			queryClient.invalidateQueries({
				queryKey: ["events", eventId, "alternative-routes"],
			});
		},
		onError: (err: Error) => {
			setFeedbackMsg({
				type: "error",
				text: err.message || "Gagal mencabut rute alternatif.",
			});
		},
	});

	const deleteMutation = useMutation({
		mutationFn: (routeId: string) => deleteAlternativeRoute(eventId, routeId),
		onSuccess: () => {
			setFeedbackMsg({
				type: "success",
				text: "Draf rute alternatif berhasil dihapus.",
			});
			queryClient.invalidateQueries({
				queryKey: ["events", eventId, "alternative-routes"],
			});
		},
		onError: (err: Error) => {
			setFeedbackMsg({
				type: "error",
				text: err.message || "Gagal menghapus draf rute alternatif.",
			});
		},
	});

	function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		setFormError(null);

		const lines = coordinatesInput
			.split("\n")
			.map((l) => l.trim())
			.filter(Boolean);
		if (lines.length < 2) {
			setFormError("Masukkan minimal 2 koordinat (garis bujur, garis lintang).");
			return;
		}

		const parsedCoords: [number, number][] = [];
		for (const line of lines) {
			const parts = line.split(",").map((p) => Number(p.trim()));
			if (parts.length < 2 || Number.isNaN(parts[0]) || Number.isNaN(parts[1])) {
				setFormError(
					`Format koordinat tidak valid: "${line}". Gunakan format "longitude, latitude", contoh: "115.258, -8.691".`,
				);
				return;
			}
			parsedCoords.push([parts[0], parts[1]]);
		}

		createMutation.mutate(parsedCoords);
	}

	const routes = routesQuery.data?.alternativeRoutes ?? [];

	return (
		<div className="teduh-workspace-card space-y-4">
			<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#E5E3DC] pb-4">
				<div className="space-y-1">
					<div className="flex items-center gap-2">
						<span className="inline-flex items-center justify-center w-6 h-6 rounded-lg bg-[#EBF3EF] text-[#264D3B]">
							<MapPin className="w-3.5 h-3.5" />
						</span>
						<h2 className="text-sm font-bold text-[#181817]">
							Jalur Alternatif Terverifikasi Panitia
						</h2>
					</div>
					<p className="text-xs text-[#585854]">
						Pengalihan arus lalu lintas yang diverifikasi prajuru untuk menghindari ruas jalan yang ditutup.
					</p>
				</div>

				{isOrganizer && !isAdding ? (
					<button
						type="button"
						onClick={() => setIsAdding(true)}
						className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#264D3B] text-white text-xs font-semibold hover:bg-[#1d3c2e] min-h-[44px] transition-all cursor-pointer"
					>
						<Plus className="w-3.5 h-3.5" />
						<span>Tambah Rute Alternatif</span>
					</button>
				) : null}
			</div>

			{feedbackMsg ? (
				<div
					className={`p-3 rounded-xl text-xs flex items-center justify-between ${
						feedbackMsg.type === "success"
							? "bg-[#EBF3EF] text-[#264D3B] border border-[#C7DBD0]"
							: "bg-[#FDF2F2] text-[#991B1B] border border-[#F87171]"
					}`}
				>
					<span>{feedbackMsg.text}</span>
					<button
						type="button"
						onClick={() => setFeedbackMsg(null)}
						className="text-xs underline ml-2 cursor-pointer"
					>
						Tutup
					</button>
				</div>
			) : null}

			{/* Form Tambah Rute Baru */}
			{isAdding ? (
				<form
					onSubmit={handleSubmit}
					className="p-4 rounded-xl border border-[#264D3B] bg-[#FAF9F5] space-y-3"
				>
					<h3 className="text-xs font-bold text-[#181817]">
						Rancang Rute Pengalihan Baru
					</h3>

					<div>
						<label
							htmlFor="alt-route-name"
							className="block text-xs font-semibold text-[#181817] mb-1"
						>
							Nama Jalur Alternatif
						</label>
						<input
							id="alt-route-name"
							type="text"
							required
							placeholder="Contoh: Jalur Pengalihan Jl. Danau Tamblingan ke Jl. Bypass"
							value={name}
							onChange={(e) => setName(e.target.value)}
							className="w-full px-3 py-2 rounded-xl border border-[#E5E3DC] bg-white text-xs text-[#181817] focus:outline-none focus:ring-2 focus:ring-[#264D3B] min-h-[44px]"
						/>
					</div>

					<div>
						<label
							htmlFor="alt-route-desc"
							className="block text-xs font-semibold text-[#181817] mb-1"
						>
							Keterangan / Kendaraan yang Diizinkan
						</label>
						<input
							id="alt-route-desc"
							type="text"
							placeholder="Contoh: Khusus sepeda motor dan mobil pribadi roda empat"
							value={description}
							onChange={(e) => setDescription(e.target.value)}
							className="w-full px-3 py-2 rounded-xl border border-[#E5E3DC] bg-white text-xs text-[#181817] focus:outline-none focus:ring-2 focus:ring-[#264D3B] min-h-[44px]"
						/>
					</div>

					<div>
						<label
							htmlFor="alt-route-coords"
							className="block text-xs font-semibold text-[#181817] mb-1"
						>
							Titik Koordinat Bali (satu titik per baris: bujur, lintang)
						</label>
						<textarea
							id="alt-route-coords"
							rows={4}
							value={coordinatesInput}
							onChange={(e) => setCoordinatesInput(e.target.value)}
							className="w-full px-3 py-2 rounded-xl border border-[#E5E3DC] bg-white font-mono text-xs text-[#181817] focus:outline-none focus:ring-2 focus:ring-[#264D3B]"
						/>
						<p className="text-[11px] text-[#8C8B85] mt-1">
							Koordinat harus berada di rentang Bali (bujur 114.4°..115.8°, lintang -8.9°..-8.0°).
						</p>
					</div>

					{formError ? (
						<div className="p-2.5 rounded-lg bg-[#FDF2F2] border border-[#F87171] text-[#991B1B] text-xs flex items-center gap-2">
							<AlertCircle className="w-3.5 h-3.5 shrink-0" />
							<span>{formError}</span>
						</div>
					) : null}

					<div className="flex items-center gap-2 pt-1">
						<button
							type="submit"
							disabled={createMutation.isPending}
							className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#264D3B] text-white text-xs font-semibold hover:bg-[#1d3c2e] disabled:opacity-50 min-h-[44px] cursor-pointer"
						>
							{createMutation.isPending ? (
								<>
									<Loader2 className="w-3.5 h-3.5 animate-spin" />
									<span>Menyimpan Draf...</span>
								</>
							) : (
								<>
									<Check className="w-3.5 h-3.5" />
									<span>Simpan Draf Rute</span>
								</>
							)}
						</button>

						<button
							type="button"
							onClick={() => setIsAdding(false)}
							className="inline-flex items-center px-3.5 py-2 rounded-xl border border-[#E5E3DC] bg-white text-xs font-semibold text-[#585854] hover:bg-[#F3F1EC] min-h-[44px] cursor-pointer"
						>
							Batal
						</button>
					</div>
				</form>
			) : null}

			{/* Daftar Rute Alternatif */}
			{routesQuery.isLoading ? (
				<div className="py-8 text-center text-xs text-[#585854] flex items-center justify-center gap-2">
					<Loader2 className="w-4 h-4 animate-spin text-[#264D3B]" />
					<span>Memuat jalur alternatif...</span>
				</div>
			) : routes.length === 0 ? (
				<div className="py-6 text-center rounded-xl border border-dashed border-[#E5E3DC] bg-[#FAF9F5] p-6 space-y-1">
					<p className="text-xs font-semibold text-[#181817]">Belum Ada Jalur Alternatif</p>
					<p className="text-xs text-[#585854]">
						Prajuru dapat menambahkan jalur pengalihan resmi yang diverifikasi untuk memandu pengendara.
					</p>
				</div>
			) : (
				<div className="space-y-3">
					{routes.map((route) => {
						const isApproved = route.status === "approved";
						const isRevoked = route.status === "revoked";
						const isDraft = route.status === "draft";

						return (
							<div
								key={route.id}
								className="p-3.5 rounded-xl border border-[#E5E3DC] bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-3"
							>
								<div className="space-y-1">
									<div className="flex items-center gap-2">
										<h4 className="text-xs font-bold text-[#181817]">{route.name}</h4>
										<span
											className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
												isApproved
													? "bg-[#EBF3EF] text-[#264D3B]"
													: isRevoked
														? "bg-[#FDF2F2] text-[#991B1B]"
														: "bg-[#FEF9E7] text-[#92400E]"
											}`}
										>
											{isApproved ? "Disetujui Publik" : isRevoked ? "Dicabut" : "Draf Panitia"}
										</span>
									</div>
									{route.description ? (
										<p className="text-xs text-[#585854]">{route.description}</p>
									) : null}
									<p className="text-[11px] text-[#8C8B85]">
										{isApproved && route.approvedAt
											? `Disetujui pada ${new Date(route.approvedAt).toLocaleDateString("id-ID")}`
											: route.createdAt
												? `Dibuat pada ${new Date(route.createdAt).toLocaleDateString("id-ID")}`
												: "-"}
									</p>
								</div>

								{isOrganizer ? (
									<div className="flex items-center gap-2 shrink-0">
										{isDraft ? (
											<>
												<button
													type="button"
													onClick={() => approveMutation.mutate(route.id)}
													disabled={approveMutation.isPending}
													className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#264D3B] text-white text-xs font-semibold hover:bg-[#1d3c2e] min-h-[40px] cursor-pointer"
												>
													<CheckCircle2 className="w-3.5 h-3.5" />
													<span>Setujui</span>
												</button>

												<button
													type="button"
													onClick={() => deleteMutation.mutate(route.id)}
													disabled={deleteMutation.isPending}
													className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[#E5E3DC] bg-white text-[#991B1B] text-xs font-semibold hover:bg-[#FDF2F2] min-h-[40px] cursor-pointer"
												>
													<Trash2 className="w-3.5 h-3.5" />
													<span>Hapus</span>
												</button>
											</>
										) : isApproved ? (
											<button
												type="button"
												onClick={() => revokeMutation.mutate(route.id)}
												disabled={revokeMutation.isPending}
												className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-[#E5E3DC] bg-white text-[#991B1B] text-xs font-semibold hover:bg-[#FDF2F2] min-h-[40px] cursor-pointer"
											>
												<XCircle className="w-3.5 h-3.5" />
												<span>Cabut dari Publik</span>
											</button>
										) : null}
									</div>
								) : null}
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Public Alternative Routes Display (Ticket 06 & 07)
// ---------------------------------------------------------------------------
export function PublicAlternativeRoutesList({ slug }: { slug: string }) {
	const routesQuery = useQuery({
		queryKey: ["public", "events", slug, "alternative-routes"],
		queryFn: () => fetchPublicAlternativeRoutes(slug),
		enabled: Boolean(slug),
		staleTime: 30_000,
	});

	const routes = routesQuery.data?.alternativeRoutes ?? [];
	if (routes.length === 0) return null;

	return (
		<div className="rounded-2xl border border-[#C7DBD0] bg-[#F6FAF7] p-5 space-y-3">
			<div className="flex items-center gap-2">
				<span className="inline-flex items-center justify-center w-6 h-6 rounded-lg bg-[#264D3B] text-white">
					<MapPin className="w-3.5 h-3.5" />
				</span>
				<div>
					<h3 className="text-sm font-bold text-[#181817]">
						Jalur Alternatif Terverifikasi Panitia
					</h3>
					<p className="text-xs text-[#585854]">
						Gunakan jalur ini untuk menghindari jalan yang ditutup selama kegiatan upacara.
					</p>
				</div>
			</div>

			<div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
				{routes.map((route) => (
					<div
						key={route.id}
						className="p-3.5 rounded-xl border border-[#E5E3DC] bg-white space-y-1 shadow-2xs"
					>
						<div className="flex items-center justify-between gap-2">
							<h4 className="text-xs font-bold text-[#181817]">{route.name}</h4>
							<span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#EBF3EF] text-[#264D3B]">
								Rute Resmi
							</span>
						</div>
						{route.description ? (
							<p className="text-xs text-[#585854]">{route.description}</p>
						) : null}
						<p className="text-[10px] text-[#8C8B85]">
							Disetujui prajuru desa adat • Hindari antrean
						</p>
					</div>
				))}
			</div>
		</div>
	);
}
