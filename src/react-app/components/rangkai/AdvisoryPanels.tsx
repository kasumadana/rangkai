import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	AlertTriangle,
	Check,
	CheckCircle2,
	ClipboardCheck,
	Copy,
	FileText,
	Info,
	Loader2,
	RefreshCw,
	Sparkles,
	Trash2,
} from "lucide-react";
import { useState } from "react";
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
// 1. Grounded Impact Planner Panel (Ticket 05)
// ---------------------------------------------------------------------------
export function ImpactPlannerPanel({
	eventId,
	isOrganizer,
}: {
	eventId: string;
	isOrganizer: boolean;
}) {
	const queryClient = useQueryClient();
	const [feedbackMsg, setFeedbackMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

	const impactQuery = useQuery({
		queryKey: ["advisory", "impact-analysis", eventId],
		queryFn: () => fetchLatestImpactAnalysis(eventId),
		enabled: Boolean(eventId),
	});

	const generateMutation = useMutation({
		mutationFn: () => runImpactAnalysis(eventId),
		onSuccess: () => {
			setFeedbackMsg({ type: "success", text: "Analisis dampak berhasil diperbarui berdasarkan data jalan dan waktu upacara." });
			queryClient.invalidateQueries({ queryKey: ["advisory", "impact-analysis", eventId] });
		},
		onError: (err: Error) => {
			setFeedbackMsg({ type: "error", text: err.message || "Gagal menjalankan analisis dampak." });
		},
	});

	const decisionMutation = useMutation({
		mutationFn: ({ runId, decision, reason }: { runId: string; decision: "approved" | "dismissed"; reason?: string }) =>
			submitImpactDecision(eventId, runId, { decision, reason }),
		onSuccess: () => {
			setFeedbackMsg({ type: "success", text: "Keputusan prajuru telah dicatat di catatan operasional." });
			queryClient.invalidateQueries({ queryKey: ["advisory", "impact-analysis", eventId] });
		},
		onError: (err: Error) => {
			setFeedbackMsg({ type: "error", text: err.message || "Gagal mencatat keputusan." });
		},
	});

	const advisory = impactQuery.data?.advisoryRun;
	const isStale = impactQuery.data?.isStale;
	const latestDecision = impactQuery.data?.latestDecision;

	return (
		<div className="teduh-workspace-card space-y-4">
			<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#E5E3DC] pb-4">
				<div className="space-y-1">
					<div className="flex items-center gap-2">
						<span className="inline-flex items-center justify-center w-6 h-6 rounded-lg bg-[#EBF3EF] text-[#264D3B]">
							<Sparkles className="w-3.5 h-3.5" />
						</span>
						<h2 className="text-sm font-bold text-[#181817]">
							Perencana Dampak Lalu Lintas (Grounded AI)
						</h2>
					</div>
					<p className="text-xs text-[#585854]">
						Menganalisis potensi penumpukan kendaraan, konflik persimpangan, dan rekomendasi pos pecalang berdasarkan ruas jalan yang dipilih.
					</p>
				</div>

				{isOrganizer ? (
					<button
						type="button"
						onClick={() => generateMutation.mutate()}
						disabled={generateMutation.isPending}
						className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#264D3B] text-white text-xs font-semibold hover:bg-[#1d3c2e] disabled:opacity-50 min-h-[44px] transition-all"
					>
						{generateMutation.isPending ? (
							<>
								<Loader2 className="w-3.5 h-3.5 animate-spin" />
								<span>Menganalisis...</span>
							</>
						) : (
							<>
								<RefreshCw className="w-3.5 h-3.5" />
								<span>Jalankan Analisis Dampak</span>
							</>
						)}
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

			{isStale ? (
				<div className="p-3 rounded-xl bg-[#FEF9E7] border border-[#FDE68A] text-[#92400E] text-xs flex items-start gap-2">
					<AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
					<div>
						<p className="font-semibold">Perhatian: Data Kegiatan Telah Berubah</p>
						<p className="text-[11px] mt-0.5">
							Ruas jalan atau jadwal kegiatan telah diperbarui sejak analisis ini dibuat. Jalankan analisis ulang agar saran pos tetap mutakhir.
						</p>
					</div>
				</div>
			) : null}

			{impactQuery.isLoading ? (
				<div className="py-8 text-center text-xs text-[#585854] flex items-center justify-center gap-2">
					<Loader2 className="w-4 h-4 animate-spin text-[#264D3B]" />
					<span>Memuat riwayat analisis dampak...</span>
				</div>
			) : !advisory ? (
				<div className="py-8 text-center rounded-xl border border-dashed border-[#E5E3DC] bg-[#FAF9F5] p-6 space-y-2">
					<Info className="w-6 h-6 text-[#8C8B85] mx-auto" />
					<p className="text-xs font-semibold text-[#181817]">Belum Ada Analisis Dampak</p>
					<p className="text-xs text-[#585854] max-w-md mx-auto">
						Tekan tombol &quot;Jalankan Analisis Dampak&quot; di atas untuk memeriksa potensi titik macet dan usulan tugas pecalang.
					</p>
				</div>
			) : (
				<div className="space-y-4">
					{/* Status dan Keputusan Terakhir */}
					<div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl bg-[#F7F6F2] border border-[#E5E3DC]">
						<div className="text-xs text-[#585854]">
							Dianalisis pada:{" "}
							<span className="font-medium text-[#181817]">
								{new Date(advisory.createdAt).toLocaleString("id-ID", { timeZone: "Asia/Makassar" })} WITA
							</span>
						</div>
						{latestDecision ? (
							<span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold ${
								latestDecision.decision === "approved"
									? "bg-[#EBF3EF] text-[#264D3B]"
									: "bg-[#F3F1EC] text-[#585854]"
							}`}>
								<CheckCircle2 className="w-3 h-3" />
								{latestDecision.decision === "approved" ? "Diterima Prajuru" : "Diabaikan"}
							</span>
						) : null}
					</div>

					{/* Temuan & Resiko */}
					<div className="space-y-2">
						<h3 className="text-xs font-bold uppercase tracking-wider text-[#585854]">
							Temuan &amp; Potensi Titik Macet ({advisory.output.findings.length})
						</h3>
						<div className="space-y-2">
							{advisory.output.findings.map((finding) => (
								<div
									key={finding.id}
									className="p-3 rounded-xl border border-[#E5E3DC] bg-white space-y-1"
								>
									<div className="flex items-center justify-between gap-2">
										<h4 className="text-xs font-bold text-[#181817]">{finding.title}</h4>
										<span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
											finding.severity === "high" || finding.severity === "critical"
												? "bg-[#FDF2F2] text-[#991B1B]"
												: finding.severity === "medium"
													? "bg-[#FEF9E7] text-[#92400E]"
													: "bg-[#F3F1EC] text-[#585854]"
										}`}>
											{finding.severity}
										</span>
									</div>
									<p className="text-xs text-[#585854]">{finding.description}</p>
									{finding.factRefs.length > 0 ? (
										<div className="flex flex-wrap gap-1 mt-1">
											{finding.factRefs.map((ref, idx) => (
												<span key={idx} className="text-[10px] px-1.5 py-0.5 rounded bg-[#F3F1EC] text-[#585854]">
													Rujuk: {ref}
												</span>
											))}
										</div>
									) : null}
								</div>
							))}
						</div>
					</div>

					{/* Saran Tindakan Lapangan */}
					<div className="space-y-2">
						<h3 className="text-xs font-bold uppercase tracking-wider text-[#585854]">
							Usulan Tindakan Petugas ({advisory.output.taskSuggestions.length})
						</h3>
						<div className="grid grid-cols-1 md:grid-cols-2 gap-2">
							{advisory.output.taskSuggestions.map((sugg) => (
								<div
									key={sugg.id}
									className="p-3 rounded-xl border border-[#E5E3DC] bg-[#FAF9F5] space-y-1"
								>
									<span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-[#EBF3EF] text-[#264D3B]">
										{sugg.category}
									</span>
									<p className="text-xs font-medium text-[#181817] mt-1">{sugg.suggestedAction}</p>
								</div>
							))}
						</div>
					</div>

					{/* Disclaimer domain */}
					<p className="text-[11px] text-[#8C8B85] italic border-t border-[#E5E3DC] pt-3">
						{advisory.output.disclaimer}
					</p>

					{/* Aksi Prajuru */}
					{isOrganizer && !latestDecision ? (
						<div className="flex flex-wrap items-center gap-2 pt-2">
							<button
								type="button"
								onClick={() =>
									decisionMutation.mutate({
										runId: advisory.id,
										decision: "approved",
										reason: "Disetujui sebagai panduan pos jaga pecalang.",
									})
								}
								disabled={decisionMutation.isPending}
								className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#264D3B] text-white text-xs font-semibold hover:bg-[#1d3c2e] min-h-[44px]"
							>
								<Check className="w-3.5 h-3.5" />
								<span>Terima sebagai Catatan Operasional</span>
							</button>

							<button
								type="button"
								onClick={() =>
									decisionMutation.mutate({
										runId: advisory.id,
										decision: "dismissed",
										reason: "Diabaikan karena rute telah dipahami oleh pecalang.",
									})
								}
								disabled={decisionMutation.isPending}
								className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[#E5E3DC] bg-white text-[#585854] text-xs font-semibold hover:bg-[#F3F1EC] min-h-[44px]"
							>
								<span>Abaikan Analisis Ini</span>
							</button>
						</div>
					) : null}
				</div>
			)}
		</div>
	);
}

// ---------------------------------------------------------------------------
// 2. Reviewed Public Notice Drafts Panel (Ticket 08)
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
	const [copied, setCopied] = useState(false);
	const [feedbackMsg, setFeedbackMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

	const noticeQuery = useQuery({
		queryKey: ["advisory", "notice-draft", eventId],
		queryFn: () => fetchLatestPublicNoticeDraft(eventId),
		enabled: Boolean(eventId),
	});

	const generateMutation = useMutation({
		mutationFn: () => generatePublicNoticeDraft(eventId),
		onSuccess: () => {
			setFeedbackMsg({ type: "success", text: "Draf siaran warga berhasil dibuat dari data kegiatan yang telah ditinjau." });
			queryClient.invalidateQueries({ queryKey: ["advisory", "notice-draft", eventId] });
		},
		onError: (err: Error) => {
			setFeedbackMsg({ type: "error", text: err.message || "Gagal membuat draf siaran warga." });
		},
	});

	const decisionMutation = useMutation({
		mutationFn: ({ runId, decision, reason }: { runId: string; decision: "approved" | "dismissed"; reason?: string }) =>
			submitPublicNoticeDecision(eventId, runId, { decision, reason }),
		onSuccess: () => {
			setFeedbackMsg({ type: "success", text: "Draf siaran telah disetujui prajuru untuk disebarkan ke warga." });
			queryClient.invalidateQueries({ queryKey: ["advisory", "notice-draft", eventId] });
		},
		onError: (err: Error) => {
			setFeedbackMsg({ type: "error", text: err.message || "Gagal menyimpan persetujuan." });
		},
	});

	const draft = noticeQuery.data?.noticeDraft;
	const latestDecision = noticeQuery.data?.latestDecision;

	function handleCopy(text: string) {
		navigator.clipboard.writeText(text);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	}

	return (
		<div className="teduh-workspace-card space-y-4">
			<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#E5E3DC] pb-4">
				<div className="space-y-1">
					<div className="flex items-center gap-2">
						<span className="inline-flex items-center justify-center w-6 h-6 rounded-lg bg-[#EBF3EF] text-[#264D3B]">
							<FileText className="w-3.5 h-3.5" />
						</span>
						<h2 className="text-sm font-bold text-[#181817]">
							Draf Siaran Warga &amp; WhatsApp (Advisory AI)
						</h2>
					</div>
					<p className="text-xs text-[#585854]">
						Menghasilkan draf pengumuman ringkas dan format siaran WhatsApp banjar dari fakta kegiatan yang telah disetujui.
					</p>
				</div>

				{isOrganizer ? (
					<button
						type="button"
						onClick={() => generateMutation.mutate()}
						disabled={generateMutation.isPending}
						className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#264D3B] text-white text-xs font-semibold hover:bg-[#1d3c2e] disabled:opacity-50 min-h-[44px] transition-all"
					>
						{generateMutation.isPending ? (
							<>
								<Loader2 className="w-3.5 h-3.5 animate-spin" />
								<span>Menyusun Teks...</span>
							</>
						) : (
							<>
								<Sparkles className="w-3.5 h-3.5" />
								<span>Buat Draf Siaran Warga</span>
							</>
						)}
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

			{noticeQuery.isLoading ? (
				<div className="py-8 text-center text-xs text-[#585854] flex items-center justify-center gap-2">
					<Loader2 className="w-4 h-4 animate-spin text-[#264D3B]" />
					<span>Memuat draf siaran warga...</span>
				</div>
			) : !draft ? (
				<div className="py-8 text-center rounded-xl border border-dashed border-[#E5E3DC] bg-[#FAF9F5] p-6 space-y-2">
					<Info className="w-6 h-6 text-[#8C8B85] mx-auto" />
					<p className="text-xs font-semibold text-[#181817]">Belum Ada Draf Siaran</p>
					<p className="text-xs text-[#585854] max-w-md mx-auto">
						Tekan tombol &quot;Buat Draf Siaran Warga&quot; untuk menyusun teks pengumuman yang siap disalin ke grup WhatsApp banjar.
					</p>
				</div>
			) : (
				<div className="space-y-4">
					{/* Sub-tabs format teks */}
					<div className="flex items-center gap-2 border-b border-[#E5E3DC] pb-2">
						<button
							type="button"
							onClick={() => setActiveTab("whatsapp")}
							className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
								activeTab === "whatsapp"
									? "bg-[#264D3B] text-white"
									: "bg-white text-[#585854] hover:text-[#181817]"
							}`}
						>
							Format WhatsApp Banjar
						</button>
						<button
							type="button"
							onClick={() => setActiveTab("summary")}
							className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
								activeTab === "summary"
									? "bg-[#264D3B] text-white"
									: "bg-white text-[#585854] hover:text-[#181817]"
							}`}
						>
							Ringkasan Publik (≤100 kata)
						</button>
						<button
							type="button"
							onClick={() => setActiveTab("officer")}
							className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
								activeTab === "officer"
									? "bg-[#264D3B] text-white"
									: "bg-white text-[#585854] hover:text-[#181817]"
							}`}
						>
							Catatan Petugas Lapangan
						</button>
					</div>

					{/* Konten Teks Terpilih */}
					<div className="relative rounded-xl border border-[#E5E3DC] bg-[#FAF9F5] p-4">
						<pre className="text-xs font-sans text-[#181817] whitespace-pre-wrap leading-relaxed select-text">
							{activeTab === "whatsapp"
								? draft.output.whatsappNotice
								: activeTab === "summary"
									? draft.output.publicSummary
									: draft.output.officerBrief}
						</pre>

						<div className="mt-3 flex items-center justify-between border-t border-[#E5E3DC] pt-3">
							<span className="text-[11px] text-[#8C8B85]">
								{draft.output.wordCount} kata • {draft.output.charCount} karakter
							</span>

							<button
								type="button"
								onClick={() =>
									handleCopy(
										activeTab === "whatsapp"
											? draft.output.whatsappNotice
											: activeTab === "summary"
												? draft.output.publicSummary
												: draft.output.officerBrief,
									)
								}
								className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#E5E3DC] bg-white text-xs font-semibold text-[#181817] hover:bg-[#F3F1EC] min-h-[40px] cursor-pointer"
							>
								{copied ? (
									<>
										<Check className="w-3.5 h-3.5 text-[#264D3B]" />
										<span className="text-[#264D3B]">Tersalin!</span>
									</>
								) : (
									<>
										<Copy className="w-3.5 h-3.5 text-[#585854]" />
										<span>Salin Teks</span>
									</>
								)}
							</button>
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
								disabled={decisionMutation.isPending}
								className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#264D3B] text-white text-xs font-semibold hover:bg-[#1d3c2e] min-h-[44px]"
							>
								<Check className="w-3.5 h-3.5" />
								<span>Setujui Teks Siaran</span>
							</button>
						</div>
					) : latestDecision ? (
						<div className="p-3 rounded-xl bg-[#EBF3EF] border border-[#C7DBD0] text-[#264D3B] text-xs flex items-center gap-2">
							<CheckCircle2 className="w-4 h-4 shrink-0" />
							<span>Teks siaran telah disetujui prajuru pada {new Date(latestDecision.createdAt).toLocaleDateString("id-ID")}.</span>
						</div>
					) : null}
				</div>
			)}
		</div>
	);
}

// ---------------------------------------------------------------------------
// 3. Waste Logistics & Scenario Planning Tool (Ticket 09)
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
	const [wastePlan, setWastePlan] = useState<WastePlanRun | null>(null);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function handleCalculate(e: React.FormEvent) {
		e.preventDefault();
		setIsLoading(true);
		setError(null);
		try {
			const res = await generateWastePlan(eventId, {
				estimatedParticipants: Number(participants),
				durationHours: Number(durationHours),
			});
			setWastePlan(res.wastePlan);
		} catch (err: unknown) {
			setError(err instanceof Error ? err.message : "Gagal menghitung perkiraan sampah.");
		} finally {
			setIsLoading(false);
		}
	}

	return (
		<div className="teduh-workspace-card space-y-4">
			<div className="space-y-1 border-b border-[#E5E3DC] pb-4">
				<div className="flex items-center gap-2">
					<span className="inline-flex items-center justify-center w-6 h-6 rounded-lg bg-[#EBF3EF] text-[#264D3B]">
						<Trash2 className="w-3.5 h-3.5" />
					</span>
					<h2 className="text-sm font-bold text-[#181817]">
						Perencanaan Logistik &amp; Skenario Sampah Upacara
					</h2>
				</div>
				<p className="text-xs text-[#585854]">
					Menghitung kebutuhan karung sampah, titik pengumpulan terpilah, dan estimasi beban timbulan sampah pasca-upacara adat.
				</p>
			</div>

			{/* Form Parameter */}
			<form onSubmit={handleCalculate} className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
				<div>
					<label htmlFor="waste-participants" className="block text-xs font-semibold text-[#181817] mb-1">
						Perkiraan Krama/Pamedek (orang)
					</label>
					<input
						id="waste-participants"
						type="number"
						min="10"
						max="50000"
						value={participants}
						onChange={(e) => setParticipants(Number(e.target.value))}
						className="w-full px-3 py-2 rounded-xl border border-[#E5E3DC] bg-white text-xs text-[#181817] focus:outline-none focus:ring-2 focus:ring-[#264D3B] min-h-[44px]"
					/>
				</div>

				<div>
					<label htmlFor="waste-duration" className="block text-xs font-semibold text-[#181817] mb-1">
						Durasi Rangkaian (jam)
					</label>
					<input
						id="waste-duration"
						type="number"
						min="1"
						max="48"
						value={durationHours}
						onChange={(e) => setDurationHours(Number(e.target.value))}
						className="w-full px-3 py-2 rounded-xl border border-[#E5E3DC] bg-white text-xs text-[#181817] focus:outline-none focus:ring-2 focus:ring-[#264D3B] min-h-[44px]"
					/>
				</div>

				<div>
					<button
						type="submit"
						disabled={isLoading || !isOrganizer}
						className="w-full inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#264D3B] text-white text-xs font-semibold hover:bg-[#1d3c2e] disabled:opacity-50 min-h-[44px] transition-all cursor-pointer"
					>
						{isLoading ? (
							<>
								<Loader2 className="w-3.5 h-3.5 animate-spin" />
								<span>Menghitung...</span>
							</>
						) : (
							<>
								<Sparkles className="w-3.5 h-3.5" />
								<span>Hitung Kebutuhan Logistik</span>
							</>
						)}
					</button>
				</div>
			</form>

			{error ? (
				<div className="p-3 rounded-xl bg-[#FDF2F2] border border-[#F87171] text-[#991B1B] text-xs">
					{error}
				</div>
			) : null}

			{wastePlan ? (
				<div className="space-y-4 pt-2">
					{/* Hasil Estimasi Skenario */}
					<div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
						<div className="p-3 rounded-xl bg-[#FAF9F5] border border-[#E5E3DC] text-center">
							<span className="text-[10px] font-bold uppercase text-[#585854]">Total Timbulan</span>
							<p className="text-base font-bold text-[#181817] mt-0.5">
								{wastePlan.output.scenarioLogistics.estimatedTotalKg} kg
							</p>
							<span className="text-[10px] text-[#8C8B85]">Skenario Matematis</span>
						</div>

						<div className="p-3 rounded-xl bg-[#FAF9F5] border border-[#E5E3DC] text-center">
							<span className="text-[10px] font-bold uppercase text-[#264D3B]">Organik (Canang/Bunga)</span>
							<p className="text-base font-bold text-[#264D3B] mt-0.5">
								{wastePlan.output.scenarioLogistics.estimatedOrganicKg} kg
							</p>
							<span className="text-[10px] text-[#8C8B85]">~75% Kompos Desa</span>
						</div>

						<div className="p-3 rounded-xl bg-[#FAF9F5] border border-[#E5E3DC] text-center">
							<span className="text-[10px] font-bold uppercase text-[#1E40AF]">Daur Ulang</span>
							<p className="text-base font-bold text-[#1E40AF] mt-0.5">
								{wastePlan.output.scenarioLogistics.estimatedRecyclableKg} kg
							</p>
							<span className="text-[10px] text-[#8C8B85]">Botol / Plastik</span>
						</div>

						<div className="p-3 rounded-xl bg-[#FAF9F5] border border-[#E5E3DC] text-center">
							<span className="text-[10px] font-bold uppercase text-[#92400E]">Kebutuhan Karung</span>
							<p className="text-base font-bold text-[#92400E] mt-0.5">
								{wastePlan.output.scenarioLogistics.estimatedSackCount} karung
							</p>
							<span className="text-[10px] text-[#8C8B85]">Ukuran 25 kg</span>
						</div>
					</div>

					{/* Checklist Persiapan Kebersihan */}
					<div className="space-y-2">
						<h3 className="text-xs font-bold uppercase tracking-wider text-[#585854]">
							Checklist Operasional Kebersihan Panitia
						</h3>
						<div className="space-y-1.5">
							{wastePlan.output.checklist.map((item, idx) => (
								<div
									key={idx}
									className="flex items-start gap-2 p-2.5 rounded-xl border border-[#E5E3DC] bg-white text-xs text-[#181817]"
								>
									<ClipboardCheck className="w-4 h-4 text-[#264D3B] shrink-0 mt-0.5" />
									<span>{item}</span>
								</div>
							))}
						</div>
					</div>

					{/* Catatan Ketidakpastian & Transparansi Model (Ticket 09 & AGENTS.md §13) */}
					<div className="p-3 rounded-xl bg-[#F7F6F2] border border-[#E5E3DC] space-y-1">
						<div className="flex items-center gap-1.5 text-xs font-semibold text-[#585854]">
							<Info className="w-3.5 h-3.5" />
							<span>Transparansi Prediksi ML &amp; Standar Operasional</span>
						</div>
						<p className="text-[11px] text-[#8C8B85] leading-relaxed">
							{wastePlan.output.disclaimer}
						</p>
					</div>
				</div>
			) : null}
		</div>
	);
}
