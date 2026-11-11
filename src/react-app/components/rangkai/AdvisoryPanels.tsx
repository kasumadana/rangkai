import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	AlertCircle,
	AlertTriangle,
	Check,
	CheckCircle2,
	ClipboardCheck,
	Copy,
	Edit3,
	FileText,
	Info,
	Loader2,
	RefreshCw,
	Sparkles,
	XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
	fetchLatestImpactAnalysis,
	fetchLatestPublicNoticeDraft,
	generatePublicNoticeDraft,
	generateWastePlan,
	runImpactAnalysis,
	submitImpactDecision,
	submitPublicNoticeDecision,
	type WastePlanRun,
} from "../../lib/events-api";

// ---------------------------------------------------------------------------
// 1. Grounded Impact Planner Panel (Ticket 05 & SPEC-03 / SPEC-04 / SPEC-10)
// ---------------------------------------------------------------------------
export function ImpactPlannerPanel({
	eventId,
	isOrganizer,
}: {
	eventId: string;
	isOrganizer: boolean;
}) {
	const queryClient = useQueryClient();
	const [feedbackMsg, setFeedbackMsg] = useState<{
		type: "success" | "error";
		text: string;
	} | null>(null);

	const impactQuery = useQuery({
		queryKey: ["advisory", "impact-analysis", eventId],
		queryFn: () => fetchLatestImpactAnalysis(eventId),
		enabled: Boolean(eventId),
		retry: 1,
	});

	const generateMutation = useMutation({
		mutationFn: () => runImpactAnalysis(eventId),
		onSuccess: () => {
			setFeedbackMsg({
				type: "success",
				text: "Analisis dampak berhasil diperbarui berdasarkan data jalan dan waktu upacara.",
			});
			queryClient.invalidateQueries({
				queryKey: ["advisory", "impact-analysis", eventId],
			});
		},
		onError: (err: Error) => {
			setFeedbackMsg({
				type: "error",
				text: err.message || "Gagal menjalankan analisis dampak.",
			});
		},
	});

	const decisionMutation = useMutation({
		mutationFn: ({
			runId,
			decision,
			reason,
		}: {
			runId: string;
			decision: "approved" | "dismissed";
			reason?: string;
		}) => submitImpactDecision(eventId, runId, { decision, reason }),
		onSuccess: () => {
			setFeedbackMsg({
				type: "success",
				text: "Keputusan prajuru telah dicatat di catatan operasional.",
			});
			queryClient.invalidateQueries({
				queryKey: ["advisory", "impact-analysis", eventId],
			});
		},
		onError: (err: Error) => {
			setFeedbackMsg({
				type: "error",
				text: err.message || "Gagal mencatat keputusan.",
			});
		},
	});

	const advisory = impactQuery.data?.advisoryRun;
	const isStale = impactQuery.data?.isStale;
	const latestDecision = impactQuery.data?.latestDecision;

	return (
		<div className="teduh-workspace-card space-y-4">
			<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-stone-200 pb-4">
				<div className="space-y-1">
					<div className="flex items-center gap-2">
						<span className="inline-flex items-center justify-center w-6 h-6 rounded-lg bg-emerald-50 text-emerald-800">
							<Sparkles className="w-3.5 h-3.5" />
						</span>
						<h2 className="text-sm font-bold text-stone-900">
							Perencana Dampak Lalu Lintas (Grounded Advisory)
						</h2>
					</div>
					<p className="text-xs text-stone-600">
						Menganalisis potensi penumpukan kendaraan, konflik persimpangan, dan rekomendasi pos pecalang berdasarkan ruas jalan yang dipilih.
					</p>
				</div>

				{isOrganizer ? (
					<button
						type="button"
						onClick={() => generateMutation.mutate()}
						disabled={generateMutation.isPending}
						className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-emerald-800 text-white text-sm font-semibold hover:bg-emerald-900 disabled:opacity-50 min-h-[48px] transition-all cursor-pointer shadow-2xs"
					>
						{generateMutation.isPending ? (
							<>
								<Loader2 className="w-4 h-4 animate-spin" />
								<span>Menganalisis...</span>
							</>
						) : (
							<>
								<RefreshCw className="w-4 h-4" />
								<span>Jalankan Analisis Dampak</span>
							</>
						)}
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

			{/* SPEC-10: Differentiate Loading, Error with Retry, Empty, and Success */}
			{impactQuery.isLoading ? (
				<div className="py-8 text-center text-xs text-stone-600 flex items-center justify-center gap-2">
					<Loader2 className="w-4 h-4 animate-spin text-emerald-800" />
					<span>Memuat data analisis dampak...</span>
				</div>
			) : impactQuery.isError ? (
				<div className="p-4 rounded-xl border border-red-300 bg-red-50 space-y-2">
					<div className="flex items-center gap-2 text-red-700 text-xs font-semibold">
						<AlertTriangle className="w-4 h-4 shrink-0" />
						<span>
							Gagal memuat analisis dampak: {impactQuery.error?.message || "Layanan tidak dapat dihubungi (503)."}
						</span>
					</div>
					<button
						type="button"
						onClick={() => impactQuery.refetch()}
						className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-800 text-white text-xs font-semibold hover:bg-emerald-900 min-h-[48px] cursor-pointer"
					>
						<RefreshCw className="w-3.5 h-3.5" />
						<span>Coba Muat Ulang</span>
					</button>
				</div>
			) : !advisory ? (
				<div className="py-8 text-center rounded-xl border border-dashed border-stone-200 bg-stone-50 p-6 space-y-2">
					<Info className="w-6 h-6 text-stone-500 mx-auto" />
					<p className="text-xs font-semibold text-stone-900">Belum Ada Analisis Dampak</p>
					<p className="text-xs text-stone-600 max-w-md mx-auto">
						Tekan tombol &quot;Jalankan Analisis Dampak&quot; untuk menghasilkan pertimbangan lalu lintas, rekomendasi titik pos pecalang, dan pemeriksaan potensi tumpang-tindih rute.
					</p>
				</div>
			) : (
				<div className="space-y-4">
					{/* Provenance and Freshness Bar (SPEC-03 & SPEC-04) */}
					<div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl bg-stone-50 border border-stone-200 text-xs">
						<div className="flex items-center gap-2">
							<span className="font-semibold text-stone-900">Metode:</span>
							<span className="px-2 py-0.5 rounded bg-white border border-stone-200 text-[11px] font-mono text-stone-600">
								{advisory.modelIdentifier}
							</span>
						</div>

						{isStale ? (
							<div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-100 border border-amber-200 text-amber-800 text-[11px] font-semibold">
								<AlertTriangle className="w-3.5 h-3.5 shrink-0" />
								<span>Kondisi jalan telah berubah sejak analisis dibuat. Silakan analisis ulang.</span>
							</div>
						) : (
							<div className="flex items-center gap-1.5 text-[11px] text-emerald-800 font-medium">
								<CheckCircle2 className="w-3.5 h-3.5" />
								<span>Sesuai data ruas jalan & waktu terkini</span>
							</div>
						)}
					</div>

					{/* Temuan Utama */}
					<div className="space-y-2">
						<h3 className="text-xs font-bold text-stone-900 uppercase tracking-wider">
							Temuan Dampak Lalu Lintas
						</h3>
						<div className="space-y-2">
							{advisory.output.findings.map((finding) => (
								<div
									key={finding.id}
									className="p-3.5 rounded-xl border border-stone-200 bg-white space-y-1.5"
								>
									<div className="flex items-center justify-between gap-2">
										<h4 className="text-xs font-bold text-stone-900">{finding.title}</h4>
										<span
											className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
												finding.severity === "high"
													? "bg-red-50 text-red-700"
													: finding.severity === "medium"
														? "bg-amber-50 text-amber-800"
														: "bg-emerald-50 text-emerald-800"
											}`}
										>
											{finding.severity}
										</span>
									</div>
									<p className="text-xs text-stone-600 leading-relaxed">
										{finding.description}
									</p>
									{finding.mitigationSuggestion ? (
										<p className="text-[11px] text-emerald-800 font-medium bg-emerald-50/50 p-2 rounded-lg border border-emerald-200">
											Saran Mitigasi: {finding.mitigationSuggestion}
										</p>
									) : null}
								</div>
							))}
						</div>
					</div>

					{/* Rekomendasi Titik Pos Petugas */}
					<div className="space-y-2">
						<h3 className="text-xs font-bold text-stone-900 uppercase tracking-wider">
							Rekomendasi Pos Petugas Pecalang
						</h3>
						<div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
							{(
								advisory.output.taskRecommendations ??
								advisory.output.taskSuggestions?.map((s) => ({
									id: s.id,
									title: s.suggestedAction,
									description: `Kategori: ${s.category}`,
									priority: "normal",
								})) ??
								[]
							).map((rec) => (
								<div
									key={rec.id}
									className="p-3 rounded-xl border border-stone-200 bg-white space-y-1"
								>
									<h4 className="text-xs font-bold text-stone-900">{rec.title}</h4>
									<p className="text-xs text-stone-600">{rec.description}</p>
									<span className="inline-block mt-1 text-[10px] font-semibold text-stone-500">
										Prioritas: {rec.priority}
									</span>
								</div>
							))}
						</div>
					</div>

					{/* Status Keputusan / Tindakan Review (SPEC-10: Accurate approved vs dismissed) */}
					{isOrganizer ? (
						<div className="pt-2 border-t border-stone-200">
							{!latestDecision ? (
								<div className="flex flex-wrap items-center gap-2">
									<button
										type="button"
										onClick={() =>
											decisionMutation.mutate({
												runId: advisory.id,
												decision: "approved",
												reason: "Pertimbangan dampak telah ditinjau oleh prajuru.",
											})
										}
										disabled={decisionMutation.isPending || isStale}
										className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-emerald-800 text-white text-xs font-semibold hover:bg-emerald-900 disabled:opacity-50 min-h-[48px] cursor-pointer shadow-2xs"
									>
										<Check className="w-4 h-4" />
										<span>Setujui Pertimbangan Dampak</span>
									</button>

									<button
										type="button"
										onClick={() =>
											decisionMutation.mutate({
												runId: advisory.id,
												decision: "dismissed",
												reason: "Draf dampak diabaikan oleh prajuru.",
											})
										}
										disabled={decisionMutation.isPending}
										className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-xl border border-stone-300 bg-white text-xs font-semibold text-stone-600 hover:bg-stone-100 min-h-[48px] cursor-pointer"
									>
										<span>Abaikan Analisis Ini</span>
									</button>
								</div>
							) : (
								<div
									className={`p-3.5 rounded-xl text-xs flex items-center gap-2 ${
										latestDecision.decision === "approved"
											? "bg-emerald-50 border border-emerald-200 text-emerald-800"
											: "bg-amber-50 border border-amber-200 text-amber-800"
									}`}
								>
									{latestDecision.decision === "approved" ? (
										<CheckCircle2 className="w-4 h-4 shrink-0" />
									) : (
										<XCircle className="w-4 h-4 shrink-0" />
									)}
									<span>
										{latestDecision.decision === "approved"
											? `Pertimbangan telah disetujui prajuru pada ${new Date(latestDecision.createdAt).toLocaleDateString("id-ID")}.`
											: `Analisis ini diabaikan oleh prajuru pada ${new Date(latestDecision.createdAt).toLocaleDateString("id-ID")}.`}
										{latestDecision.reason ? ` (${latestDecision.reason})` : ""}
									</span>
								</div>
							)}
						</div>
					) : null}
				</div>
			)}
		</div>
	);
}

// ---------------------------------------------------------------------------
// 2. Public Notice Draft Panel (Ticket 08 & SPEC-05 / SPEC-06 / SPEC-10)
// ---------------------------------------------------------------------------
export function PublicNoticeDraftPanel({
	eventId,
	isOrganizer,
}: {
	eventId: string;
	isOrganizer: boolean;
}) {
	const queryClient = useQueryClient();
	const [activeTab, setActiveTab] = useState<"whatsapp" | "summary" | "officer">("whatsapp");
	const [isEditing, setIsEditing] = useState(false);
	const [editSummary, setEditSummary] = useState("");
	const [editWhatsapp, setEditWhatsapp] = useState("");
	const [editReason, setEditReason] = useState("");
	const [copied, setCopied] = useState(false);
	const [feedbackMsg, setFeedbackMsg] = useState<{
		type: "success" | "error";
		text: string;
	} | null>(null);

	const noticeQuery = useQuery({
		queryKey: ["advisory", "public-notice-draft", eventId],
		queryFn: () => fetchLatestPublicNoticeDraft(eventId),
		enabled: Boolean(eventId),
		retry: 1,
	});

	const generateMutation = useMutation({
		mutationFn: () => generatePublicNoticeDraft(eventId),
		onSuccess: () => {
			setFeedbackMsg({
				type: "success",
				text: "Draf siaran warga berhasil disusun dari data kegiatan dan jalan yang disetujui.",
			});
			setIsEditing(false);
			queryClient.invalidateQueries({
				queryKey: ["advisory", "public-notice-draft", eventId],
			});
		},
		onError: (err: Error) => {
			setFeedbackMsg({
				type: "error",
				text: err.message || "Gagal menyusun draf siaran warga.",
			});
		},
	});

	const decisionMutation = useMutation({
		mutationFn: ({
			runId,
			decision,
			reason,
			correctedPublicSummary,
			correctedWhatsappNotice,
		}: {
			runId: string;
			decision: "approved" | "rejected" | "dismissed";
			reason?: string;
			correctedPublicSummary?: string;
			correctedWhatsappNotice?: string;
		}) =>
			submitPublicNoticeDecision(eventId, runId, {
				decision,
				reason,
				correctedPublicSummary,
				correctedWhatsappNotice,
			}),
		onSuccess: () => {
			setFeedbackMsg({
				type: "success",
				text: "Keputusan prajuru dan koreksi teks berhasil dicatat.",
			});
			setIsEditing(false);
			queryClient.invalidateQueries({
				queryKey: ["advisory", "public-notice-draft", eventId],
			});
		},
		onError: (err: Error) => {
			setFeedbackMsg({
				type: "error",
				text: err.message || "Gagal mencatat keputusan draf siaran.",
			});
		},
	});

	const draft = noticeQuery.data?.noticeDraft;
	const isStale = noticeQuery.data?.isStale;
	const latestDecision = noticeQuery.data?.latestDecision;

	// Determine active text to display (SPEC-06: use accepted correctedOutputJson if approved)
	const displayedNotice = useMemo(() => {
		if (!draft) return null;
		const corrected = latestDecision?.correctedOutputJson as
			| { correctedPublicSummary?: string; correctedWhatsappNotice?: string }
			| undefined;

		const isApproved = latestDecision?.decision === "approved";
		const hasCorrected = Boolean(isApproved && (corrected?.correctedPublicSummary || corrected?.correctedWhatsappNotice));

		return {
			whatsappNotice:
				isApproved && corrected?.correctedWhatsappNotice
					? corrected.correctedWhatsappNotice
					: draft.output.whatsappNotice,
			publicSummary:
				isApproved && corrected?.correctedPublicSummary
					? corrected.correctedPublicSummary
					: draft.output.publicSummary,
			officerBrief: draft.output.officerBrief,
			isCorrectedVersion: hasCorrected,
		};
	}, [draft, latestDecision]);

	function handleStartEditing() {
		setEditSummary(displayedNotice?.publicSummary || draft?.output.publicSummary || "");
		setEditWhatsapp(displayedNotice?.whatsappNotice || draft?.output.whatsappNotice || "");
		setIsEditing(true);
	}

	// Word & character counts for live validation (SPEC-06)
	const summaryWordCount = useMemo(
		() => editSummary.split(/\s+/).filter(Boolean).length,
		[editSummary],
	);
	const whatsappCharCount = editWhatsapp.length;
	const isSummaryOverLimit = summaryWordCount > 120;
	const isWhatsappOverLimit = whatsappCharCount > 600;

	// Clipboard handling with proper async try/catch (SPEC-10)
	async function handleCopy(text: string) {
		try {
			await navigator.clipboard.writeText(text);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch {
			setFeedbackMsg({
				type: "error",
				text: "Gagal menyalin teks ke papan klip. Izin peramban diblokir atau tidak tersedia.",
			});
		}
	}

	function handleSaveCorrection() {
		if (!draft) return;
		if (isSummaryOverLimit) {
			setFeedbackMsg({
				type: "error",
				text: `Ringkasan publik maksimal 120 kata (terhitung ${summaryWordCount} kata).`,
			});
			return;
		}
		if (isWhatsappOverLimit) {
			setFeedbackMsg({
				type: "error",
				text: `Pesan WhatsApp maksimal 600 karakter (terhitung ${whatsappCharCount} karakter).`,
			});
			return;
		}

		decisionMutation.mutate({
			runId: draft.id,
			decision: "approved",
			reason: editReason.trim() || "Disetujui dengan koreksi teks panitia.",
			correctedPublicSummary: editSummary.trim(),
			correctedWhatsappNotice: editWhatsapp.trim(),
		});
	}

	return (
		<div className="teduh-workspace-card space-y-4">
			<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-stone-200 pb-4">
				<div className="space-y-1">
					<div className="flex items-center gap-2">
						<span className="inline-flex items-center justify-center w-6 h-6 rounded-lg bg-emerald-50 text-emerald-800">
							<FileText className="w-3.5 h-3.5" />
						</span>
						<h2 className="text-sm font-bold text-stone-900">
							Draf Siaran Warga &amp; WhatsApp (Grounded Advisory)
						</h2>
					</div>
					<p className="text-xs text-stone-600">
						Menghasilkan pengumuman ringkas (≤120 kata) dan format siaran WhatsApp banjar (≤600 karakter) yang terikat pada data kegiatan yang disetujui.
					</p>
				</div>

				{isOrganizer ? (
					<button
						type="button"
						onClick={() => generateMutation.mutate()}
						disabled={generateMutation.isPending}
						className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-emerald-800 text-white text-sm font-semibold hover:bg-emerald-900 disabled:opacity-50 min-h-[48px] transition-all cursor-pointer shadow-2xs"
					>
						{generateMutation.isPending ? (
							<>
								<Loader2 className="w-4 h-4 animate-spin" />
								<span>Menyusun Teks...</span>
							</>
						) : (
							<>
								<Sparkles className="w-4 h-4" />
								<span>Buat Draf Siaran Warga</span>
							</>
						)}
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

			{/* SPEC-10: Explicit Loading, Error, Empty, and Success states */}
			{noticeQuery.isLoading ? (
				<div className="py-8 text-center text-xs text-stone-600 flex items-center justify-center gap-2">
					<Loader2 className="w-4 h-4 animate-spin text-emerald-800" />
					<span>Memuat draf siaran warga...</span>
				</div>
			) : noticeQuery.isError ? (
				<div className="p-4 rounded-xl border border-red-300 bg-red-50 space-y-2">
					<div className="flex items-center gap-2 text-red-700 text-xs font-semibold">
						<AlertTriangle className="w-4 h-4 shrink-0" />
						<span>
							Gagal memuat draf siaran: {noticeQuery.error?.message || "Layanan tidak dapat dihubungi (503)."}
						</span>
					</div>
					<button
						type="button"
						onClick={() => noticeQuery.refetch()}
						className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-800 text-white text-xs font-semibold hover:bg-emerald-900 min-h-[48px] cursor-pointer"
					>
						<RefreshCw className="w-3.5 h-3.5" />
						<span>Coba Muat Ulang</span>
					</button>
				</div>
			) : !draft || !displayedNotice ? (
				<div className="py-8 text-center rounded-xl border border-dashed border-stone-200 bg-stone-50 p-6 space-y-2">
					<Info className="w-6 h-6 text-stone-500 mx-auto" />
					<p className="text-xs font-semibold text-stone-900">Belum Ada Draf Siaran</p>
					<p className="text-xs text-stone-600 max-w-md mx-auto">
						Tekan tombol &quot;Buat Draf Siaran Warga&quot; untuk menyusun teks pengumuman yang siap disalin ke grup WhatsApp banjar.
					</p>
				</div>
			) : (
				<div className="space-y-4">
					{/* Staleness and Correction Indicator */}
					<div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl bg-stone-50 border border-stone-200 text-xs">
						<div className="flex items-center gap-2 flex-wrap">
							{displayedNotice.isCorrectedVersion ? (
								<span className="px-2.5 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 font-semibold text-[11px]">
									Versi Terkoreksi (Disetujui Prajuru)
								</span>
							) : (
								<span className="px-2.5 py-0.5 rounded-full bg-white border border-stone-200 text-stone-600 text-[11px]">
									Draf Rekomendasi Sistem
								</span>
							)}
						</div>

						{isStale ? (
							<div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-100 border border-amber-200 text-amber-800 text-[11px] font-semibold">
								<AlertTriangle className="w-3.5 h-3.5 shrink-0" />
								<span>Jadwal atau ruas jalan telah diubah sejak draf ini dibuat. Buat draf ulang sebelum menyetujui.</span>
							</div>
						) : (
							<span className="text-[11px] text-stone-500">
								Dibuat pada {new Date(draft.createdAt).toLocaleDateString("id-ID")}
							</span>
						)}
					</div>

					{/* Correction Form Mode (SPEC-06) */}
					{isEditing ? (
						<div className="p-5 rounded-2xl border-2 border-emerald-800 bg-stone-50 space-y-4">
							<div className="border-b border-stone-200 pb-2">
								<h3 className="text-sm font-bold text-stone-900">
									Koreksi Teks Siaran Warga
								</h3>
								<p className="text-xs text-stone-600 mt-0.5">
									Sesuaikan redaksi pengumuman. Label simulasi dan fakta jalan tetap divalidasi oleh sistem.
								</p>
							</div>

							<div>
								<div className="flex items-center justify-between mb-1">
									<label htmlFor="edit-summary" className="text-xs font-semibold text-stone-900">
										Ringkasan Publik (Maksimal 120 kata)
									</label>
									<span
										className={`text-[11px] font-mono ${
											isSummaryOverLimit ? "text-red-700 font-bold" : "text-stone-600"
										}`}
									>
										{summaryWordCount} / 120 kata
									</span>
								</div>
								<textarea
									id="edit-summary"
									rows={3}
									value={editSummary}
									onChange={(e) => setEditSummary(e.target.value)}
									className="w-full px-3.5 py-2.5 rounded-xl border border-stone-300 bg-white text-base sm:text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-emerald-800"
								/>
							</div>

							<div>
								<div className="flex items-center justify-between mb-1">
									<label htmlFor="edit-whatsapp" className="text-xs font-semibold text-stone-900">
										Pesan WhatsApp Banjar (Maksimal 600 karakter)
									</label>
									<span
										className={`text-[11px] font-mono ${
											isWhatsappOverLimit ? "text-red-700 font-bold" : "text-stone-600"
										}`}
									>
										{whatsappCharCount} / 600 karakter
									</span>
								</div>
								<textarea
									id="edit-whatsapp"
									rows={6}
									value={editWhatsapp}
									onChange={(e) => setEditWhatsapp(e.target.value)}
									className="w-full px-3.5 py-2.5 rounded-xl border border-stone-300 bg-white text-base sm:text-sm font-mono text-stone-900 focus:outline-none focus:ring-2 focus:ring-emerald-800"
								/>
							</div>

							<div>
								<label htmlFor="edit-reason" className="block text-xs font-semibold text-stone-900 mb-1">
									Catatan Alasan Koreksi (Opsional)
								</label>
								<input
									id="edit-reason"
									type="text"
									placeholder="Contoh: Menyesuaikan sebutan banjar adat dan titik kumpul warga"
									value={editReason}
									onChange={(e) => setEditReason(e.target.value)}
									className="w-full px-3.5 py-2.5 rounded-xl border border-stone-300 bg-white text-base sm:text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-emerald-800 min-h-[48px]"
								/>
							</div>

							<div className="flex flex-wrap items-center gap-3 pt-2">
								<button
									type="button"
									disabled={decisionMutation.isPending || isSummaryOverLimit || isWhatsappOverLimit || isStale}
									onClick={handleSaveCorrection}
									className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-800 text-white text-sm font-semibold hover:bg-emerald-900 disabled:opacity-50 min-h-[48px] cursor-pointer shadow-2xs"
								>
									{decisionMutation.isPending ? (
										<Loader2 className="w-4 h-4 animate-spin" />
									) : (
										<Check className="w-4 h-4" />
									)}
									<span>Setujui dengan Koreksi Ini</span>
								</button>

								<button
									type="button"
									onClick={() => setIsEditing(false)}
									className="inline-flex items-center justify-center px-4 py-2.5 rounded-xl border border-stone-300 bg-white text-sm font-semibold text-stone-600 hover:bg-stone-100 min-h-[48px] cursor-pointer"
								>
									Batal Koreksi
								</button>
							</div>
						</div>
					) : (
						<>
							{/* Sub-tabs format teks */}
							<div className="flex items-center gap-2 border-b border-stone-200 pb-2">
								<button
									type="button"
									onClick={() => setActiveTab("whatsapp")}
									className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition-all min-h-[48px] cursor-pointer ${
										activeTab === "whatsapp"
											? "bg-emerald-800 text-white shadow-2xs"
											: "bg-white text-stone-600 hover:text-stone-900"
									}`}
								>
									Format WhatsApp Banjar (≤600 kar)
								</button>
								<button
									type="button"
									onClick={() => setActiveTab("summary")}
									className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition-all min-h-[48px] cursor-pointer ${
										activeTab === "summary"
											? "bg-emerald-800 text-white shadow-2xs"
											: "bg-white text-stone-600 hover:text-stone-900"
									}`}
								>
									Ringkasan Publik (≤120 kata)
								</button>
								<button
									type="button"
									onClick={() => setActiveTab("officer")}
									className={`px-3.5 py-2 rounded-xl text-xs font-semibold transition-all min-h-[48px] cursor-pointer ${
										activeTab === "officer"
											? "bg-emerald-800 text-white shadow-2xs"
											: "bg-white text-stone-600 hover:text-stone-900"
									}`}
								>
									Catatan Petugas Lapangan
								</button>
							</div>

							{/* Konten Teks Terpilih */}
							<div className="relative rounded-2xl border border-stone-200 bg-stone-50 p-5 shadow-2xs">
								<pre className="text-sm font-sans text-stone-900 whitespace-pre-wrap leading-relaxed select-text">
									{activeTab === "whatsapp"
										? displayedNotice.whatsappNotice
										: activeTab === "summary"
											? displayedNotice.publicSummary
											: displayedNotice.officerBrief}
								</pre>

								<div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-stone-200 pt-3">
									<span className="text-[11px] text-stone-500">
										{activeTab === "whatsapp"
											? `${displayedNotice.whatsappNotice.length} karakter`
											: `${displayedNotice.publicSummary.split(/\s+/).filter(Boolean).length} kata`}
									</span>

									<div className="flex items-center gap-2">
										{isOrganizer && (!latestDecision || latestDecision.decision !== "approved") ? (
											<button
												type="button"
												onClick={handleStartEditing}
												className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-stone-300 bg-white text-xs font-semibold text-stone-900 hover:bg-stone-100 min-h-[48px] cursor-pointer"
											>
												<Edit3 className="w-3.5 h-3.5 text-stone-600" />
												<span>Koreksi Redaksi</span>
											</button>
										) : null}

										<button
											type="button"
											onClick={() =>
												handleCopy(
													activeTab === "whatsapp"
														? displayedNotice.whatsappNotice
														: activeTab === "summary"
															? displayedNotice.publicSummary
															: displayedNotice.officerBrief,
												)
											}
											className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-stone-300 bg-white text-xs font-semibold text-stone-900 hover:bg-stone-100 min-h-[48px] cursor-pointer shadow-2xs"
										>
											{copied ? (
												<>
													<Check className="w-4 h-4 text-emerald-800" />
													<span className="text-emerald-800">Tersalin!</span>
												</>
											) : (
												<>
													<Copy className="w-4 h-4 text-stone-600" />
													<span>Salin Teks</span>
												</>
											)}
										</button>
									</div>
								</div>
							</div>

							{/* Persetujuan Prajuru */}
							{isOrganizer && !latestDecision ? (
								<div className="flex flex-wrap items-center gap-2 pt-2">
									<button
										type="button"
										onClick={() =>
											decisionMutation.mutate({
												runId: draft.id,
												decision: "approved",
												reason: "Teks siaran disetujui untuk diumumkan ke warga desa.",
											})
										}
										disabled={decisionMutation.isPending || isStale}
										className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-800 text-white text-xs font-semibold hover:bg-emerald-900 disabled:opacity-50 min-h-[48px] cursor-pointer shadow-2xs"
									>
										<Check className="w-4 h-4" />
										<span>Setujui Teks Siaran (Sesuai Draf)</span>
									</button>
								</div>
							) : latestDecision ? (
								<div
									className={`p-3.5 rounded-xl text-xs flex items-center gap-2 ${
										latestDecision.decision === "approved"
											? "bg-emerald-50 border border-emerald-200 text-emerald-800"
											: "bg-amber-50 border border-amber-200 text-amber-800"
									}`}
								>
									{latestDecision.decision === "approved" ? (
										<CheckCircle2 className="w-4 h-4 shrink-0" />
									) : (
										<XCircle className="w-4 h-4 shrink-0" />
									)}
									<span>
										{latestDecision.decision === "approved"
											? `Teks siaran telah disetujui prajuru pada ${new Date(latestDecision.createdAt).toLocaleDateString("id-ID")}.`
											: `Draf siaran diabaikan pada ${new Date(latestDecision.createdAt).toLocaleDateString("id-ID")}.`}
										{latestDecision.reason ? ` (${latestDecision.reason})` : ""}
									</span>
								</div>
							) : null}
						</>
					)}
				</div>
			)}
		</div>
	);
}

// ---------------------------------------------------------------------------
// 3. Waste Logistics & Scenario Planning Tool (Ticket 09 & SPEC-09 / STD-02)
// ---------------------------------------------------------------------------
export function WastePlanningPanel({
	eventId,
	isOrganizer,
}: {
	eventId: string;
	isOrganizer: boolean;
}) {
	const [participants, setParticipants] = useState(500);
	const [durationHours, setDurationHours] = useState(6);
	const [useExplicitCoefficients, setUseExplicitCoefficients] = useState(false);
	const [wasteRate, setWasteRate] = useState(0.35);
	const [organicPct, setOrganicPct] = useState(65);
	const [recyclablePct, setRecyclablePct] = useState(20);
	const [residualPct, setResidualPct] = useState(15);
	const [wastePlan, setWastePlan] = useState<WastePlanRun | null>(null);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function handleCalculate(e: React.FormEvent) {
		e.preventDefault();
		setIsLoading(true);
		setError(null);
		try {
			const payload: {
				estimatedParticipants: number;
				durationHours: number;
				wastePerPersonDayKg?: number;
				organicFraction?: number;
				recyclableFraction?: number;
				residualFraction?: number;
			} = {
				estimatedParticipants: Number(participants),
				durationHours: Number(durationHours),
			};

			if (useExplicitCoefficients) {
				payload.wastePerPersonDayKg = Number(wasteRate);
				payload.organicFraction = Number(organicPct) / 100;
				payload.recyclableFraction = Number(recyclablePct) / 100;
				payload.residualFraction = Number(residualPct) / 100;
			} else {
				// Omitting rate or passing 0 triggers the honest operational checklist mode (SPEC-09)
				payload.wastePerPersonDayKg = 0;
			}

			const res = await generateWastePlan(eventId, payload);
			setWastePlan(res.wastePlan);
		} catch (err: unknown) {
			setError(err instanceof Error ? err.message : "Gagal menghitung panduan sampah.");
		} finally {
			setIsLoading(false);
		}
	}

	return (
		<div className="teduh-workspace-card space-y-4">
			<div className="border-b border-stone-200 pb-4">
				<div className="flex items-center gap-2">
					<span className="inline-flex items-center justify-center w-6 h-6 rounded-lg bg-emerald-50 text-emerald-800">
						<ClipboardCheck className="w-3.5 h-3.5" />
					</span>
					<h2 className="text-sm font-bold text-stone-900">
						Rencana Logistik &amp; Kebersihan Pasca-Upacara
					</h2>
				</div>
				<p className="text-xs text-stone-600 mt-1">
					Menyusun panduan penanganan sarana upakara (canang, dresta, residu) dan daftar periksa operasional posko kebersihan banjar.
				</p>
			</div>

			{isOrganizer ? (
				<form onSubmit={handleCalculate} className="p-4 rounded-xl border border-stone-200 bg-stone-50 space-y-4">
					<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
						<div>
							<label htmlFor="waste-participants" className="block text-xs font-semibold text-stone-900 mb-1.5">
								Perkiraan Pamedek / Warga (Orang)
							</label>
							<input
								id="waste-participants"
								type="number"
								min={1}
								max={100000}
								value={participants}
								onChange={(e) => setParticipants(Number(e.target.value))}
								className="w-full px-3.5 py-2.5 rounded-xl border border-stone-300 bg-white text-base sm:text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-emerald-800 min-h-[48px]"
							/>
						</div>

						<div>
							<label htmlFor="waste-duration" className="block text-xs font-semibold text-stone-900 mb-1.5">
								Durasi Pelaksanaan Upacara (Jam)
							</label>
							<input
								id="waste-duration"
								type="number"
								min={1}
								max={48}
								value={durationHours}
								onChange={(e) => setDurationHours(Number(e.target.value))}
								className="w-full px-3.5 py-2.5 rounded-xl border border-stone-300 bg-white text-base sm:text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-emerald-800 min-h-[48px]"
							/>
						</div>
					</div>

					{/* Explicit user coefficients toggle (SPEC-09: No fabricated hidden defaults) */}
					<div className="pt-2 border-t border-stone-200 space-y-3">
						<label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-stone-900">
							<input
								type="checkbox"
								checked={useExplicitCoefficients}
								onChange={(e) => setUseExplicitCoefficients(e.target.checked)}
								className="w-4 h-4 text-emerald-800 rounded border-stone-300 focus:ring-emerald-800"
							/>
							<span>Gunakan Koefisien Timbulan Sampah Berdasarkan Data Pengguna</span>
						</label>

						{useExplicitCoefficients ? (
							<div className="p-3.5 rounded-xl border border-emerald-200 bg-white space-y-3 text-xs">
								<div>
									<label htmlFor="waste-rate" className="block font-semibold text-stone-900 mb-1">
										Koefisien Timbulan (kg / orang / hari)
									</label>
									<input
										id="waste-rate"
										type="number"
										step="0.05"
										min="0.05"
										max="2.0"
										value={wasteRate}
										onChange={(e) => setWasteRate(Number(e.target.value))}
										className="w-full px-3 py-2 rounded-lg border border-stone-300 bg-white text-base sm:text-sm text-stone-900 min-h-[48px]"
									/>
								</div>

								<div className="grid grid-cols-3 gap-2">
									<div>
										<label htmlFor="waste-org" className="block font-semibold text-stone-900 mb-1">
											Organik (%)
										</label>
										<input
											id="waste-org"
											type="number"
											min={0}
											max={100}
											value={organicPct}
											onChange={(e) => setOrganicPct(Number(e.target.value))}
											className="w-full px-3 py-2 rounded-lg border border-stone-300 bg-white text-base sm:text-sm text-stone-900 min-h-[48px]"
										/>
									</div>
									<div>
										<label htmlFor="waste-rec" className="block font-semibold text-stone-900 mb-1">
											Daur Ulang (%)
										</label>
										<input
											id="waste-rec"
											type="number"
											min={0}
											max={100}
											value={recyclablePct}
											onChange={(e) => setRecyclablePct(Number(e.target.value))}
											className="w-full px-3 py-2 rounded-lg border border-stone-300 bg-white text-base sm:text-sm text-stone-900 min-h-[48px]"
										/>
									</div>
									<div>
										<label htmlFor="waste-res" className="block font-semibold text-stone-900 mb-1">
											Residu (%)
										</label>
										<input
											id="waste-res"
											type="number"
											min={0}
											max={100}
											value={residualPct}
											onChange={(e) => setResidualPct(Number(e.target.value))}
											className="w-full px-3 py-2 rounded-lg border border-stone-300 bg-white text-base sm:text-sm text-stone-900 min-h-[48px]"
										/>
									</div>
								</div>
								<p className="text-[11px] text-stone-500">
									Total proporsi harus 100% (saat ini: {organicPct + recyclablePct + residualPct}%).
								</p>
							</div>
						) : (
							<p className="text-[11px] text-stone-600">
								Mode default: Daftar periksa operasional banjar tanpa angka estimasi tonase spekulatif.
							</p>
						)}
					</div>

					{error ? (
						<div className="p-3 rounded-xl bg-red-50 border border-red-300 text-red-700 text-xs flex items-center gap-2">
							<AlertCircle className="w-4 h-4 shrink-0" />
							<span>{error}</span>
						</div>
					) : null}

					<button
						type="submit"
						disabled={isLoading}
						className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-800 text-white text-sm font-semibold hover:bg-emerald-900 disabled:opacity-50 min-h-[48px] cursor-pointer shadow-2xs"
					>
						{isLoading ? (
							<>
								<Loader2 className="w-4 h-4 animate-spin" />
								<span>Menyusun Panduan...</span>
							</>
						) : (
							<>
								<ClipboardCheck className="w-4 h-4" />
								<span>
									{useExplicitCoefficients ? "Hitung Estimasi & Susun Panduan" : "Tampilkan Daftar Periksa Operasional"}
								</span>
							</>
						)}
					</button>
				</form>
			) : null}

			{/* Hasil Panduan & Logistik */}
			{wastePlan ? (
				<div className="space-y-4 pt-2">
					{wastePlan.output.scenarioLogistics ? (
						<div className="p-4 rounded-xl border border-emerald-200 bg-emerald-50/50 space-y-3">
							<div className="flex items-center justify-between text-xs font-semibold text-emerald-800">
								<span>Estimasi Skenario Logistik Sampah</span>
								<span className="text-[11px] font-normal text-stone-600">
									Berdasarkan koefisien pengguna ({wastePlan.output.assumptions?.rateKgPerParticipantPerDay} kg/orang/hari)
								</span>
							</div>

							<div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-center">
								<div className="p-2.5 rounded-lg bg-white border border-stone-200">
									<span className="text-[10px] text-stone-600 block">Organik</span>
									<span className="text-sm font-bold text-green-800">
										{wastePlan.output.scenarioLogistics.estimatedOrganicKg} kg
									</span>
								</div>
								<div className="p-2.5 rounded-lg bg-white border border-stone-200">
									<span className="text-[10px] text-stone-600 block">Daur Ulang</span>
									<span className="text-sm font-bold text-sky-600">
										{wastePlan.output.scenarioLogistics.estimatedRecyclableKg} kg
									</span>
								</div>
								<div className="p-2.5 rounded-lg bg-white border border-stone-200">
									<span className="text-[10px] text-stone-600 block">Residu</span>
									<span className="text-sm font-bold text-red-700">
										{wastePlan.output.scenarioLogistics.estimatedResidualKg} kg
									</span>
								</div>
								<div className="p-2.5 rounded-lg bg-white border border-stone-200">
									<span className="text-[10px] text-stone-600 block">Kebutuhan Karung</span>
									<span className="text-sm font-bold text-stone-900">
										~{wastePlan.output.scenarioLogistics.estimatedSackCount} karung
									</span>
								</div>
							</div>
						</div>
					) : (
						<div className="p-3.5 rounded-xl border border-stone-200 bg-stone-50 text-xs text-stone-600 leading-relaxed">
							<strong>Mode Daftar Periksa:</strong> Sistem menyajikan daftar periksa operasional tanpa angka estimasi tonase karena belum tersedianya data timbulan berdasar hasil pengukuran lapangan.
						</div>
					)}

					{/* Checklist Operasional */}
					<div className="space-y-2">
						<h3 className="text-xs font-bold text-stone-900 uppercase tracking-wider">
							Daftar Periksa Pengelolaan Kebersihan
						</h3>
						<div className="space-y-1.5">
							{wastePlan.output.checklist.map((item, idx) => (
								<div
									key={idx}
									className="p-3 rounded-xl border border-stone-200 bg-white flex items-start gap-2.5 text-xs text-stone-900"
								>
									<CheckCircle2 className="w-4 h-4 text-emerald-800 shrink-0 mt-0.5" />
									<span>{item}</span>
								</div>
							))}
						</div>
					</div>

					<p className="text-[11px] text-stone-500 italic pt-1">
						{wastePlan.output.disclaimer}
					</p>
				</div>
			) : null}
		</div>
	);
}
