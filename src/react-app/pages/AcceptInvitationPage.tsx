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
import { saveOrganizationId } from "../lib/events-api";

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
			saveOrganizationId(res.organizationId);
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
						border: "1px solid var(--color-border)",
						borderRadius: 4,
						padding: "28px 24px",
						display: "flex",
						flexDirection: "column",
						gap: 20,
					}}
				>
					{isInviteLoading ? (
						<div style={{ textAlign: "center", padding: "40px 0", color: "#545B67" }}>
							<p style={{ margin: 0, fontSize: "1rem" }}>Memeriksa keabsahan tautan undangan...</p>
						</div>
					) : inviteError || !inviteData?.valid ? (
						<div style={{ textAlign: "center", display: "flex", flexDirection: "column", gap: 14 }}>
							<AlertCircle size={40} color="#B91C1C" style={{ margin: "0 auto" }} />
							<h1 style={{ margin: 0, fontSize: "1.625rem", fontWeight: 600, color: "#181B20" }}>
								Tautan Undangan Tidak Berlaku
							</h1>
							<p style={{ margin: 0, fontSize: "1rem", color: "#545B67", lineHeight: 1.6 }}>
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
										padding: "4px 10px",
										borderRadius: 4,
										background: "#FFFFFF",
										border: "1px solid #4D702F",
										color: "#4D702F",
										fontSize: "0.875rem",
										fontWeight: 600,
										marginBottom: 10,
									}}
								>
									{inviteData.invitationRole === "organizer" ? "Undangan Penyelenggara" : "Undangan Petugas Lapangan"}
								</span>
								<h1
									style={{
										margin: "0 0 8px 0",
										fontSize: "1.625rem",
										fontWeight: 600,
										color: "#181B20",
										fontFamily: "var(--font-sans)",
										letterSpacing: "-0.015em",
									}}
								>
									Bergabung ke {inviteData.organization.name}
								</h1>
								<p style={{ margin: 0, fontSize: "1rem", lineHeight: 1.6, color: "#545B67" }}>
									{inviteData.invitationRole === "organizer" ? "Anda diundang sebagai penyelenggara organisasi ini." : "Anda diundang bertugas dalam koordinasi kegiatan upacara adat di Bali."}
								</p>
							</div>

							{/* Event & Permissions Summary Card */}
							<div
								style={{
									background: "#FFFFFF",
									borderRadius: 4,
									padding: "16px",
									display: "flex",
									flexDirection: "column",
									gap: 12,
									border: "1px solid var(--color-border)",
								}}
							>
								{inviteData.event ? (
									<div>
										<div style={{ fontSize: "0.875rem", color: "#545B67", fontWeight: 600 }}>
											Kegiatan yang ditugaskan
										</div>
										<div style={{ fontSize: "1rem", fontWeight: 600, color: "#181B20", marginTop: 2 }}>
											{inviteData.event.title}
										</div>
									</div>
								) : null}

								{inviteData.invitationRole === "officer" ? (
									<div>
										<div style={{ fontSize: "0.875rem", color: "#545B67", fontWeight: 600, marginBottom: 6 }}>
											Izin hak tugas lapangan
										</div>
										<div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
											{inviteData.permissions.canUpdateTraffic && (
												<div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "1rem", color: "#4D702F", fontWeight: 600 }}>
													<Radio size={16} />
													<span>Pembaruan Status Ruas Jalan (Pecalang)</span>
												</div>
											)}
											{inviteData.permissions.canUpdateCleanup && (
												<div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "1rem", color: "#4D702F", fontWeight: 600 }}>
													<Trash2 size={16} />
													<span>Pemeriksaan Foto Bukti & Catatan Sampah (Kebersihan)</span>
												</div>
											)}
										</div>
									</div>
								) : (
									<p style={{ margin: 0, fontSize: "1rem", color: "#545B67" }}>
										Hak penyelenggara berlaku untuk organisasi ini. Tidak ada tugas lapangan yang diberikan.
									</p>
								)}
							</div>

							{actionError && (
								<div
									role="alert"
									style={{
										background: "#FFFFFF",
										border: "1px solid #B91C1C",
										borderRadius: 4,
										padding: "12px 14px",
										fontSize: "1rem",
										color: "#B91C1C",
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
											background: "#FFFFFF",
											border: "1px solid #B91C1C",
											borderRadius: 4,
											padding: "16px",
											display: "flex",
											flexDirection: "column",
											gap: 10,
										}}
									>
										<div style={{ display: "flex", alignItems: "center", gap: 8, color: "#B91C1C", fontWeight: 600, fontSize: "1rem" }}>
											<AlertCircle size={18} />
											<span>Alamat Email Tidak Cocok</span>
										</div>
										<p style={{ margin: 0, fontSize: "1rem", color: "#545B67", lineHeight: 1.5 }}>
											Undangan ini ditujukan untuk email: <strong>{targetEmail}</strong>. Saat ini Anda masuk sebagai: <strong>{sessionEmail}</strong>.
										</p>
										<div style={{ display: "flex", gap: 8, marginTop: 4 }}>
											<button
												type="button"
												onClick={() => signOutMutation.mutate()}
												disabled={signOutMutation.isPending}
												className="ui-button"
												style={{
													background: "#B91C1C",
													borderColor: "#B91C1C",
													color: "#FFFFFF",
												}}
											>
												Keluar Akun & Ganti Email
											</button>
										</div>
										{signOutMutation.isError ? (
											<p role="alert" style={{ color: "#B91C1C", margin: 0 }}>
												Tidak dapat keluar. Periksa koneksi dan coba lagi.
											</p>
										) : null}
									</div>
								) : (
									<div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
										<div
											style={{
												fontSize: "1rem",
												color: "#545B67",
												background: "#FFFFFF",
												border: "1px solid var(--color-border)",
												borderRadius: 4,
												padding: "10px 14px",
											}}
										>
											Masuk sebagai: <strong>{sessionData.user.name}</strong> ({sessionData.user.email})
										</div>
										<button
											type="button"
											onClick={handleAccept}
											disabled={acceptMutation.isPending}
											className="ui-button ui-button-primary"
											style={{
												gap: 8,
												cursor: acceptMutation.isPending ? "not-allowed" : "pointer",
												opacity: acceptMutation.isPending ? 0.75 : 1,
											}}
										>
											<CheckCircle2 size={16} />
											<span>{acceptMutation.isPending ? "Menerima..." : "Terima Undangan & Mulai Bertugas"}</span>
										</button>
									</div>
								)
							) : (
								<div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
									<p style={{ margin: 0, fontSize: "1rem", color: "#545B67", lineHeight: 1.5 }}>
										Untuk menerima undangan ini dan mencatat tugas di lapangan, Anda perlu masuk atau mendaftar akun terlebih dahulu:
									</p>
									<div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
										<Link
											to="/login"
											state={{ from: `/invite/${token}` }}
											className="ui-button ui-button-primary"
											style={{ flex: 1, gap: 8 }}
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
