import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	AlertCircle,
	AlertTriangle,
	Check,
	CheckCircle2,
	Compass,
	Copy,
	Info,
	Loader2,
	Plus,
	RefreshCw,
	Trash2,
	XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
	approveAlternativeRoute,
	createAlternativeRoute,
	deleteAlternativeRoute,
	fetchAlternativeRoutes,
	fetchPublicAlternativeRoutes,
	revokeAlternativeRoute,
} from "../../lib/events-api";

/**
 * Parses user input into a list of [longitude, latitude] coordinates.
 * Accepts either:
 * - Line-separated: "115.258, -8.691"
 * - GeoJSON LineString JSON: {"type":"LineString","coordinates":[[115.258,-8.691],...]}
 * - Raw JSON array: [[115.258, -8.691], ...]
 */
function parseCoordinatesInput(raw: string): {
	coords: [number, number][];
	error: string | null;
} {
	const trimmed = raw.trim();
	if (!trimmed) {
		return { coords: [], error: null };
	}

	// Try JSON parsing first
	if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
		try {
			const parsed = JSON.parse(trimmed);
			let arrayCoords: unknown[] = [];
			if (Array.isArray(parsed)) {
				arrayCoords = parsed;
			} else if (parsed?.type === "LineString" && Array.isArray(parsed.coordinates)) {
				arrayCoords = parsed.coordinates;
			} else if (parsed?.geometry?.type === "LineString" && Array.isArray(parsed.geometry.coordinates)) {
				arrayCoords = parsed.geometry.coordinates;
			}

			if (arrayCoords.length >= 2) {
				const valid: [number, number][] = [];
				for (const item of arrayCoords) {
					if (Array.isArray(item) && item.length >= 2) {
						const lng = Number(item[0]);
						const lat = Number(item[1]);
						if (!Number.isNaN(lng) && !Number.isNaN(lat)) {
							valid.push([lng, lat]);
						}
					}
				}
				if (valid.length >= 2) {
					return { coords: valid, error: null };
				}
			}
		} catch {
			// Fall through to line-by-line parsing
		}
	}

	// Line-by-line format: "lng, lat"
	const lines = trimmed.split("\n").map((l) => l.trim()).filter(Boolean);
	if (lines.length < 2) {
		return { coords: [], error: "Masukkan minimal 2 titik koordinat (satu titik per baris: bujur, lintang)." };
	}

	const coords: [number, number][] = [];
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const parts = line.split(",").map((p) => Number(p.trim()));
		if (parts.length < 2 || Number.isNaN(parts[0]) || Number.isNaN(parts[1])) {
			return {
				coords: [],
				error: `Format baris ke-${i + 1} tidak valid: "${line}". Gunakan format "bujur, lintang", contoh: "115.258, -8.691".`,
			};
		}
		// Validate Bali bounding box
		if (parts[0] < 114.4 || parts[0] > 115.8 || parts[1] < -8.9 || parts[1] > -8.0) {
			return {
				coords: [],
				error: `Titik ke-${i + 1} (${parts[0]}, ${parts[1]}) di luar wilayah daratan Bali (bujur 114.4°..115.8°, lintang -8.9°..-8.0°).`,
			};
		}
		coords.push([parts[0], parts[1]]);
	}

	return { coords, error: null };
}

// ---------------------------------------------------------------------------
// Organizer Alternative Routes Manager (Ticket 06 & STD-02 / SPEC-08 / SPEC-10)
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
	// SPEC-08: Empty initial coordinates; never start with arbitrary Sanur coordinates
	const [coordinatesInput, setCoordinatesInput] = useState("");
	const [isRoadFollowingConfirmed, setIsRoadFollowingConfirmed] = useState(false);
	const [formError, setFormError] = useState<string | null>(null);
	const [feedbackMsg, setFeedbackMsg] = useState<{
		type: "success" | "error";
		text: string;
	} | null>(null);

	const routesQuery = useQuery({
		queryKey: ["events", eventId, "alternative-routes"],
		queryFn: () => fetchAlternativeRoutes(eventId),
		enabled: Boolean(eventId),
		retry: 1,
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
			setCoordinatesInput("");
			setIsRoadFollowingConfirmed(false);
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
				text: "Rute alternatif telah disetujui dan dapat dilihat warga di peta publik (terikat masa berlaku upacara).",
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

	const parsedResult = useMemo(
		() => parseCoordinatesInput(coordinatesInput),
		[coordinatesInput],
	);

	function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		setFormError(null);

		if (!name.trim()) {
			setFormError("Nama rute alternatif wajib diisi.");
			return;
		}

		if (parsedResult.error) {
			setFormError(parsedResult.error);
			return;
		}

		if (parsedResult.coords.length < 2) {
			setFormError("Masukkan minimal 2 titik koordinat untuk membentuk jalur pengalihan.");
			return;
		}

		if (!isRoadFollowingConfirmed) {
			setFormError(
				"Konfirmasi penelusuran jalan nyata wajib dicentang untuk memastikan rute bukan garis lurus spekulatif.",
			);
			return;
		}

		createMutation.mutate(parsedResult.coords);
	}

	const routes = routesQuery.data?.alternativeRoutes ?? [];

	// Preview SVG path calculation for geometric verification (SPEC-08)
	const previewSvg = useMemo(() => {
		const coords = parsedResult.coords;
		if (coords.length < 2) return null;

		let minX = coords[0][0];
		let maxX = coords[0][0];
		let minY = coords[0][1];
		let maxY = coords[0][1];

		for (const [x, y] of coords) {
			if (x < minX) minX = x;
			if (x > maxX) maxX = x;
			if (y < minY) minY = y;
			if (y > maxY) maxY = y;
		}

		const spanX = Math.max(maxX - minX, 0.001);
		const spanY = Math.max(maxY - minY, 0.001);
		const width = 280;
		const height = 90;
		const padding = 14;

		const points = coords.map(([x, y]) => {
			const px = padding + ((x - minX) / spanX) * (width - 2 * padding);
			const py = height - padding - ((y - minY) / spanY) * (height - 2 * padding);
			return `${px.toFixed(1)},${py.toFixed(1)}`;
		});

		return {
			pathD: `M ${points.join(" L ")}`,
			start: points[0],
			end: points[points.length - 1],
			count: coords.length,
		};
	}, [parsedResult.coords]);

	return (
		<div className="teduh-workspace-card space-y-4">
			<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-stone-200 pb-4">
				<div className="space-y-1">
					<div className="flex items-center gap-2">
						<span className="inline-flex items-center justify-center w-6 h-6 rounded-lg bg-emerald-50 text-emerald-800">
							<Compass className="w-3.5 h-3.5" />
						</span>
						<h2 className="text-sm font-bold text-stone-900">
							Jalur Alternatif Terverifikasi Panitia
						</h2>
					</div>
					<p className="text-xs text-stone-600">
						Pengalihan arus lalu lintas yang diverifikasi prajuru untuk memandu warga menghindari ruas jalan yang ditutup.
					</p>
				</div>

				{isOrganizer && !isAdding ? (
					<button
						type="button"
						onClick={() => {
							setIsAdding(true);
							setFormError(null);
						}}
						className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-emerald-800 text-white text-sm font-semibold hover:bg-emerald-900 min-h-[48px] transition-all cursor-pointer shadow-2xs"
					>
						<Plus className="w-4 h-4" />
						<span>Tambah Rute Alternatif</span>
					</button>
				) : null}
			</div>

			{feedbackMsg ? (
				<div
					className={`p-3.5 rounded-xl text-xs flex items-center justify-between ${
						feedbackMsg.type === "success"
							? "bg-emerald-50 text-emerald-800 border border-emerald-200"
							: "bg-red-50 text-red-700 border border-red-300"
					}`}
				>
					<span>{feedbackMsg.text}</span>
					<button
						type="button"
						onClick={() => setFeedbackMsg(null)}
						className="text-xs font-semibold underline ml-2 cursor-pointer min-h-[48px] px-2"
					>
						Tutup
					</button>
				</div>
			) : null}

			{/* Form Tambah Rute Baru (SPEC-08 & STD-02: font size >=16px, target >=48px) */}
			{isAdding ? (
				<form
					onSubmit={handleSubmit}
					className="p-5 rounded-2xl border-2 border-emerald-800 bg-stone-50 space-y-4"
				>
					<div className="border-b border-stone-200 pb-2">
						<h3 className="text-sm font-bold text-stone-900">
							Rancang Rute Pengalihan Sementara (Simulasi)
						</h3>
						<p className="text-xs text-stone-600 mt-0.5">
							Masukkan titik koordinat nyata yang melintasi ruas jalan alternatif layak pakai.
						</p>
					</div>

					<div>
						<label
							htmlFor="alt-route-name"
							className="block text-xs font-semibold text-stone-900 mb-1.5"
						>
							Nama Jalur Alternatif <span className="text-red-700">*</span>
						</label>
						<input
							id="alt-route-name"
							type="text"
							required
							placeholder="Contoh: Jalur Pengalihan Jl. Danau Poso via Gang Betutu"
							value={name}
							onChange={(e) => setName(e.target.value)}
							className="w-full px-3.5 py-2.5 rounded-xl border border-stone-300 bg-white text-base sm:text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-emerald-800 min-h-[48px]"
						/>
					</div>

					<div>
						<label
							htmlFor="alt-route-desc"
							className="block text-xs font-semibold text-stone-900 mb-1.5"
						>
							Keterangan / Kendaraan yang Diizinkan (Opsional)
						</label>
						<input
							id="alt-route-desc"
							type="text"
							placeholder="Contoh: Khusus sepeda motor dan kendaraan roda empat ringan"
							value={description}
							onChange={(e) => setDescription(e.target.value)}
							className="w-full px-3.5 py-2.5 rounded-xl border border-stone-300 bg-white text-base sm:text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-emerald-800 min-h-[48px]"
						/>
					</div>

					<div>
						<label
							htmlFor="alt-route-coords"
							className="block text-xs font-semibold text-stone-900 mb-1.5"
						>
							Titik Koordinat Rute (LineString bujur, lintang atau GeoJSON) <span className="text-red-700">*</span>
						</label>
						<textarea
							id="alt-route-coords"
							rows={4}
							value={coordinatesInput}
							onChange={(e) => setCoordinatesInput(e.target.value)}
							placeholder={"115.258, -8.691\n115.260, -8.695\n115.262, -8.700"}
							className="w-full px-3.5 py-2.5 rounded-xl border border-stone-300 bg-white font-mono text-base sm:text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-emerald-800"
						/>
						<p className="text-[11px] text-stone-500 mt-1">
							Masukkan koordinat berurutan di wilayah Bali (bujur 114.4°..115.8°, lintang -8.9°..-8.0°). Anda juga dapat menempelkan potongan GeoJSON LineString.
						</p>
					</div>

					{/* Geometric Preview Box (SPEC-08) */}
					{previewSvg ? (
						<div className="p-3.5 rounded-xl border border-emerald-200 bg-emerald-50/50 space-y-2">
							<div className="flex items-center justify-between text-xs text-emerald-800 font-semibold">
								<span className="flex items-center gap-1.5">
									<CheckCircle2 className="w-4 h-4 text-emerald-800" />
									<span>Pratinjau Geometris Terbaca ({previewSvg.count} titik koordinat)</span>
								</span>
								<span className="text-[11px] text-stone-600">
									Titik Awal: {parsedResult.coords[0][0].toFixed(3)}, {parsedResult.coords[0][1].toFixed(3)}
								</span>
							</div>

							<div className="w-full h-24 bg-white rounded-lg border border-stone-200 flex items-center justify-center p-2 relative overflow-hidden">
								<svg
									viewBox="0 0 280 90"
									className="w-full h-full max-h-20"
									preserveAspectRatio="xMidYMid meet"
								>
									<path
										d={previewSvg.pathD}
										fill="none"
										stroke="#2563EB"
										strokeWidth="3.5"
										strokeDasharray="4 3"
										strokeLinecap="round"
										strokeLinejoin="round"
									/>
									{/* Start dot (green) */}
									<circle
										cx={previewSvg.start.split(",")[0]}
										cy={previewSvg.start.split(",")[1]}
										r="4"
										fill="#16A34A"
									/>
									{/* End dot (red) */}
									<circle
										cx={previewSvg.end.split(",")[0]}
										cy={previewSvg.end.split(",")[1]}
										r="4"
										fill="#DC2626"
									/>
								</svg>
								<div className="absolute bottom-1 right-2 text-[10px] text-stone-500">
									Garis putus-putus biru = Jalur Alternatif
								</div>
							</div>
						</div>
					) : null}

					{/* Road-following human verification gate (SPEC-08) */}
					<div className="p-3.5 rounded-xl border border-stone-200 bg-white">
						<label className="flex items-start gap-3 cursor-pointer">
							<input
								type="checkbox"
								checked={isRoadFollowingConfirmed}
								onChange={(e) => setIsRoadFollowingConfirmed(e.target.checked)}
								className="mt-1 w-4 h-4 text-emerald-800 rounded border-stone-300 focus:ring-emerald-800 shrink-0"
							/>
							<span className="text-xs text-stone-900 leading-relaxed">
								<strong className="font-semibold block">Verifikasi Kesesuaian Jalan Nyata:</strong>
								Saya mengonfirmasi bahwa koordinat rute di atas mengikuti ruas jalan nyata yang dapat dilalui kendaraan secara aman dan telah diperiksa kelayakannya oleh panitia.
							</span>
						</label>
					</div>

					{formError ? (
						<div className="p-3 rounded-xl bg-red-50 border border-red-300 text-red-700 text-xs flex items-center gap-2">
							<AlertCircle className="w-4 h-4 shrink-0" />
							<span>{formError}</span>
						</div>
					) : null}

					<div className="flex flex-wrap items-center gap-3 pt-2">
						<button
							type="submit"
							disabled={createMutation.isPending || !isRoadFollowingConfirmed || parsedResult.coords.length < 2}
							className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-800 text-white text-sm font-semibold hover:bg-emerald-900 disabled:opacity-50 min-h-[48px] cursor-pointer shadow-2xs"
						>
							{createMutation.isPending ? (
								<>
									<Loader2 className="w-4 h-4 animate-spin" />
									<span>Menyimpan Draf...</span>
								</>
							) : (
								<>
									<Check className="w-4 h-4" />
									<span>Simpan Draf Rute</span>
								</>
							)}
						</button>

						<button
							type="button"
							onClick={() => {
								setIsAdding(false);
								setFormError(null);
							}}
							className="inline-flex items-center justify-center px-4 py-2.5 rounded-xl border border-stone-300 bg-white text-sm font-semibold text-stone-600 hover:bg-stone-100 min-h-[48px] cursor-pointer"
						>
							Batal
						</button>
					</div>
				</form>
			) : null}

			{/* Daftar Rute Alternatif (SPEC-10: Error Banner with retry) */}
			{routesQuery.isLoading ? (
				<div className="py-8 text-center text-xs text-stone-600 flex items-center justify-center gap-2">
					<Loader2 className="w-4 h-4 animate-spin text-emerald-800" />
					<span>Memuat jalur alternatif...</span>
				</div>
			) : routesQuery.isError ? (
				<div className="p-4 rounded-xl border border-red-300 bg-red-50 space-y-2">
					<div className="flex items-center gap-2 text-red-700 text-xs font-semibold">
						<AlertTriangle className="w-4 h-4 shrink-0" />
						<span>
							Gagal memuat daftar jalur alternatif: {routesQuery.error?.message || "Layanan tidak dapat dihubungi."}
						</span>
					</div>
					<button
						type="button"
						onClick={() => routesQuery.refetch()}
						className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-800 text-white text-xs font-semibold hover:bg-emerald-900 min-h-[48px] cursor-pointer"
					>
						<RefreshCw className="w-3.5 h-3.5" />
						<span>Coba Muat Ulang</span>
					</button>
				</div>
			) : routes.length === 0 ? (
				<div className="py-8 text-center rounded-xl border border-dashed border-stone-200 bg-stone-50 p-6 space-y-2">
					<Info className="w-6 h-6 text-stone-500 mx-auto" />
					<p className="text-xs font-semibold text-stone-900">Belum Ada Jalur Alternatif</p>
					<p className="text-xs text-stone-600 max-w-sm mx-auto">
						Prajuru dapat menambahkan jalur pengalihan sementara untuk memandu warga saat penutupan jalan berlangsung.
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
								className="p-4 rounded-xl border border-stone-200 bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs"
							>
								<div className="space-y-1">
									<div className="flex items-center gap-2 flex-wrap">
										<h4 className="text-sm font-bold text-stone-900">{route.name}</h4>
										<span
											className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
												isApproved
													? "bg-emerald-50 text-emerald-800"
													: isRevoked
														? "bg-red-50 text-red-700"
														: "bg-amber-50 text-amber-800"
											}`}
										>
											{isApproved
												? "Disetujui Publik (Simulasi)"
												: isRevoked
													? "Dicabut"
													: "Draf Panitia"}
										</span>
									</div>
									{route.description ? (
										<p className="text-xs text-stone-600">{route.description}</p>
									) : null}
									<p className="text-[11px] text-stone-500">
										{isApproved && route.approvedAt
											? `Disetujui pada ${new Date(route.approvedAt).toLocaleDateString("id-ID")}`
											: route.createdAt
												? `Dibuat pada ${new Date(route.createdAt).toLocaleDateString("id-ID")}`
												: "-"}
										{route.expiresAt
											? ` • Berlaku hingga ${new Date(route.expiresAt).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })} WITA`
											: ""}
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
													className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-800 text-white text-xs font-semibold hover:bg-emerald-900 min-h-[48px] cursor-pointer shadow-2xs"
												>
													{approveMutation.isPending ? (
														<Loader2 className="w-4 h-4 animate-spin" />
													) : (
														<CheckCircle2 className="w-4 h-4" />
													)}
													<span>Setujui</span>
												</button>

												<button
													type="button"
													onClick={() => deleteMutation.mutate(route.id)}
													disabled={deleteMutation.isPending}
													className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-stone-200 bg-white text-red-700 text-xs font-semibold hover:bg-red-50 min-h-[48px] cursor-pointer"
												>
													<Trash2 className="w-4 h-4" />
													<span>Hapus</span>
												</button>
											</>
										) : isApproved ? (
											<button
												type="button"
												onClick={() => revokeMutation.mutate(route.id)}
												disabled={revokeMutation.isPending}
												className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl border border-red-300 bg-white text-red-700 text-xs font-semibold hover:bg-red-50 min-h-[48px] cursor-pointer"
											>
												{revokeMutation.isPending ? (
													<Loader2 className="w-4 h-4 animate-spin" />
												) : (
													<XCircle className="w-4 h-4" />
												)}
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
// Public Alternative Routes Display (Ticket 06 & SPEC-08, SPEC-10)
// ---------------------------------------------------------------------------
export function PublicAlternativeRoutesList({ slug }: { slug: string }) {
	const [copiedId, setCopiedId] = useState<string | null>(null);
	const [copyError, setCopyError] = useState<string | null>(null);

	const routesQuery = useQuery({
		queryKey: ["public", "events", slug, "alternative-routes"],
		queryFn: () => fetchPublicAlternativeRoutes(slug),
		enabled: Boolean(slug),
		staleTime: 30_000,
	});

	async function handleCopyRoute(route: { name: string; description?: string; coordinates: [number, number][] }) {
		setCopyError(null);
		const coordText = route.coordinates.map(([lng, lat]) => `${lng}, ${lat}`).join("\n");
		const fullText = `${route.name}\n${route.description ? `${route.description}\n` : ""}Titik:\n${coordText}`;
		try {
			await navigator.clipboard.writeText(fullText);
			setCopiedId(route.name);
			setTimeout(() => setCopiedId(null), 2000);
		} catch {
			setCopyError("Gagal menyalin rute ke papan klip. Salin teks secara manual.");
		}
	}

	const routes = routesQuery.data?.alternativeRoutes ?? [];
	if (routes.length === 0) return null;

	return (
		<div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-5 space-y-4">
			<div className="flex items-start gap-3">
				<span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-emerald-800 text-white shrink-0 mt-0.5">
					<Compass className="w-4 h-4" />
				</span>
				<div className="space-y-1">
					<h3 className="text-sm font-bold text-stone-900">
						Jalur Alternatif Sementara (Panduan Panitia)
					</h3>
					<p className="text-xs text-stone-600">
						Panduan jalur pengalihan sementara yang dirancang panitia desa adat untuk membantu menghindari ruas jalan kegiatan upacara.
					</p>
				</div>
			</div>

			{/* Disclaimer Box (Honest Domain State: SPEC-08) */}
			<div className="p-3 rounded-xl border border-stone-200 bg-white text-xs text-stone-600 leading-relaxed flex items-start gap-2">
				<Info className="w-4 h-4 text-stone-500 shrink-0 mt-0.5" />
				<span>
					<strong>Catatan Operasional:</strong> Rute ini merupakan simulasi koordinasi adat dan bukan izin resmi penutupan lalu lintas. Selalu patuhi rambu resmi dan arahan petugas Kepolisian, Dishub, atau Pecalang di lokasi upacara.
				</span>
			</div>

			{copyError ? (
				<div className="p-2.5 rounded-lg bg-red-50 border border-red-300 text-red-700 text-xs">
					{copyError}
				</div>
			) : null}

			<div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 pt-1">
				{routes.map((route) => (
					<div
						key={route.id}
						className="p-4 rounded-xl border border-stone-200 bg-white space-y-2 shadow-2xs"
					>
						<div className="flex items-start justify-between gap-2">
							<h4 className="text-xs font-bold text-stone-900 leading-snug">{route.name}</h4>
							<span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-800 shrink-0">
								Simulasi Alternatif
							</span>
						</div>
						{route.description ? (
							<p className="text-xs text-stone-600">{route.description}</p>
						) : null}

						{/* Text fallback for coordinates checkpoints (SPEC-08) */}
						{route.geometry && Array.isArray(route.geometry.coordinates) ? (
							<div className="pt-1 border-t border-stone-100 text-[11px] text-stone-500 flex items-center justify-between">
								<span>
									{route.geometry.coordinates.length} titik koordinat pengalihan
								</span>
								<button
									type="button"
									onClick={() =>
										handleCopyRoute({
											name: route.name,
											description: route.description ?? undefined,
											coordinates: route.geometry.coordinates as [number, number][],
										})
									}
									className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-stone-200 bg-white text-xs text-emerald-800 hover:bg-stone-50 font-semibold cursor-pointer min-h-[48px] shadow-2xs"
								>
									{copiedId === route.name ? (
										<>
											<Check className="w-3 h-3" />
											<span>Tersalin!</span>
										</>
									) : (
										<>
											<Copy className="w-3 h-3" />
											<span>Salin Titik</span>
										</>
									)}
								</button>
							</div>
						) : null}
					</div>
				))}
			</div>
		</div>
	);
}
