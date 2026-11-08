import {
	AlertCircle,
	CheckCircle2,
	LogIn,
	Radio,
	Trash2,
	UserPlus,
} from "lucide-react";
import { useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ApiClientError } from "../lib/api-client";
import {
	useAcceptInvitationMutation,
	useAuthSession,
	useInvitationQuery,
	useSignOutMutation,
} from "../lib/auth";
import { useGsapPageReveal } from "../lib/gsap-motion";

export function AcceptInvitationPage() {
	const params = useParams();
	const token = params.token || "";
	const navigate = useNavigate();
	const pageRef = useRef<HTMLDivElement>(null);

	const { data: sessionData, isLoading: isSessionLoading } = useAuthSession();
	const signOutMutation = useSignOutMutation();
	const { data: inviteData, isLoading: isInviteLoading, error: inviteError } =
		useInvitationQuery(token);
	const acceptMutation = useAcceptInvitationMutation();

	const [actionError, setActionError] = useState<string | null>(null);

	useGsapPageReveal(pageRef, [isInviteLoading, Boolean(inviteData?.valid)]);

	const sessionEmail = sessionData?.user?.email?.trim().toLowerCase();
	const targetEmail = inviteData?.recipientEmail?.trim().toLowerCase();
	const isEmailMismatch = Boolean(
		sessionEmail && targetEmail && sessionEmail !== targetEmail,
	);

	async function handleAccept() {
		setActionError(null);
		try {
			const res = await acceptMutation.mutateAsync(token);
			if (res.role === "organizer" || !res.eventId) {
				navigate("/dashboard");
			} else {
				navigate(`/field/events/${res.eventId}`);
			}
		} catch (err) {
			if (err instanceof ApiClientError) {
				setActionError(err.message);
			} else {
				setActionError(
					"Gagal memproses penerimaan undangan. Pastikan koneksi internet stabil.",
				);
			}
		}
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
			<div style={{ width: "100%", maxWidth: 500 }}>
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
					{isInviteLoading ? (
						<div style={{ textAlign: "center", padding: "40px 0", color: "#545B67" }}>
							<p style={{ margin: 0, fontSize: 15 }}>Memeriksa keabsahan tautan undangan...</p>
						</div>
					) : inviteError || !inviteData?.valid ? (
						<div style={{ textAlign: "center", display: "flex", flexDirection: "column", gap: 14 }}>
							<AlertCircle size={40} color="#9E2A2B" style={{ margin: "0 auto" }} />
							<h1 style={{ margin: 0, fontSize: 22, fontWeight: 400, color: "#181B20" }}>
								Tautan Undangan Tidak Berlaku
							</h1>
							<p style={{ margin: 0, fontSize: 14, color: "#545B67", lineHeight: 1.6 }}>
								Tautan ini mungkin telah kedaluwarsa atau sudah digunakan sebelumnya. Silakan hubungi Prajuru / Organizer Anda untuk mendapatkan tautan baru.
							</p>
							<div style={{ marginTop: 8 }}>
								<Link to="/" className="teduh-back-link">
									<span>Kembali ke Beranda</span>
								</Link>
							</div>
						</div>
					) : (
						<>
							<div>
								<span
									style={{
										display: "inline-block",
										padding: "3px 10px",
										borderRadius: 9999,
										background: "#ECF3EF",
										color: "#264D3B",
										fontSize: 12,
										fontWeight: 600,
										marginBottom: 10,
									}}
								>
									Undangan Petugas Lapangan Resmi
								</span>
								<h1
									style={{
										margin: "0 0 8px 0",
										fontSize: 24,
										fontWeight: 400,
										color: "#181B20",
										fontFamily: "var(--font-family)",
										letterSpacing: "-0.02em",
									}}
								>
									Bergabung ke {inviteData.organization.name}
								</h1>
								<p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: "#545B67" }}>
									Anda diundang bertugas dalam koordinasi kegiatan upacara adat di Bali.
								</p>
							</div>

							{/* Event & Permissions Summary Card */}
							<div
								style={{
									background: "#F8FAF8",
									borderRadius: 16,
									padding: "18px 20px",
									display: "flex",
									flexDirection: "column",
									gap: 12,
									border: "1px solid rgba(228, 231, 229, 0.8)",
								}}
							>
								<div>
									<div style={{ fontSize: 11.5, color: "#71717A", fontWeight: 500, textTransform: "uppercase" }}>
										Kegiatan yang Ditugaskan
									</div>
									<div style={{ fontSize: 15, fontWeight: 600, color: "#181B20", marginTop: 2 }}>
										{inviteData.event.title}
									</div>
								</div>

								<div>
									<div style={{ fontSize: 11.5, color: "#71717A", fontWeight: 500, textTransform: "uppercase", marginBottom: 6 }}>
										Izin Hak Tugas Lapangan
									</div>
									<div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
										{inviteData.permissions.canUpdateTraffic && (
											<div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#264D3B", fontWeight: 500 }}>
												<Radio size={16} />
												<span>Pembaruan Status Ruas Jalan (Pecalang)</span>
											</div>
										)}
										{inviteData.permissions.canUpdateCleanup && (
											<div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#264D3B", fontWeight: 500 }}>
												<Trash2 size={16} />
												<span>Pemeriksaan Foto Bukti & Catatan Sampah (Kebersihan)</span>
											</div>
										)}
									</div>
								</div>
							</div>

							{actionError && (
								<div
									style={{
										background: "#FDF2F2",
										border: "1px solid rgba(158, 42, 43, 0.2)",
										borderRadius: 12,
										padding: "12px 14px",
										fontSize: 13,
										color: "#9E2A2B",
									}}
								>
									{actionError}
								</div>
							)}

							{/* Actions: Logged In vs Logged Out */}
							{!isSessionLoading && sessionData?.user ? (
								isEmailMismatch ? (
									<div
										style={{
											background: "#FEF2F2",
											border: "1px solid rgba(185, 28, 28, 0.3)",
											borderRadius: 14,
											padding: "16px 18px",
											display: "flex",
											flexDirection: "column",
											gap: 10,
										}}
									>
										<div style={{ display: "flex", alignItems: "center", gap: 8, color: "#9E2A2B", fontWeight: 600, fontSize: 14 }}>
											<AlertCircle size={18} />
											<span>Alamat Email Tidak Cocok</span>
										</div>
										<p style={{ margin: 0, fontSize: 13, color: "#545B67", lineHeight: 1.5 }}>
											Undangan ini ditujukan untuk email: <strong>{targetEmail}</strong>. Saat ini Anda masuk sebagai: <strong>{sessionEmail}</strong>.
										</p>
										<div style={{ display: "flex", gap: 8, marginTop: 4 }}>
											<button
												type="button"
												onClick={() => signOutMutation.mutate()}
												style={{
													background: "#9E2A2B",
													color: "#FFFFFF",
													border: "none",
													borderRadius: 9999,
													padding: "8px 16px",
													fontSize: 12.5,
													cursor: "pointer",
													fontWeight: 500,
												}}
											>
												Keluar Akun & Ganti Email
											</button>
										</div>
									</div>
								) : (
									<div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
										<div
											style={{
												fontSize: 13,
												color: "#545B67",
												background: "#F4F4F3",
												borderRadius: 12,
												padding: "10px 14px",
											}}
										>
											Masuk sebagai: <strong>{sessionData.user.name}</strong> ({sessionData.user.email})
										</div>
										<button
											type="button"
											onClick={handleAccept}
											disabled={acceptMutation.isPending}
											style={{
												background: "#264D3B",
												color: "#FFFFFF",
												border: "none",
												borderRadius: 9999,
												padding: "12px 20px",
												fontSize: 14,
												fontWeight: 500,
												display: "flex",
												alignItems: "center",
												justifyContent: "center",
												gap: 8,
												cursor: acceptMutation.isPending ? "not-allowed" : "pointer",
												opacity: acceptMutation.isPending ? 0.75 : 1,
												transition: "all var(--transition-fast)",
											}}
										>
											<CheckCircle2 size={16} />
											<span>{acceptMutation.isPending ? "Menerima..." : "Terima Undangan & Mulai Bertugas"}</span>
										</button>
									</div>
								)
							) : (
								<div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
									<p style={{ margin: 0, fontSize: 13.5, color: "#545B67", lineHeight: 1.5 }}>
										Untuk menerima undangan ini dan mencatat tugas di lapangan, Anda perlu masuk atau mendaftar akun terlebih dahulu:
									</p>
									<div style={{ display: "flex", gap: 10 }}>
										<Link
											to="/login"
											state={{ from: `/invite/${token}` }}
											className="teduh-pill-action"
											style={{ flex: 1, justifyContent: "center" }}
										>
											<LogIn size={15} />
											<span>Masuk Akun</span>
										</Link>
										<Link
											to="/register"
											state={{ from: `/invite/${token}`, email: inviteData.recipientEmail }}
											className="teduh-back-link"
											style={{ flex: 1, justifyContent: "center" }}
										>
											<UserPlus size={15} />
											<span>Daftar Akun</span>
										</Link>
									</div>
								</div>
							)}
						</>
					)}
				</div>
			</div>
		</div>
	);
}
