import {
	ArrowLeft,
	Compass,
	Eye,
	EyeOff,
	KeyRound,
	LayoutDashboard,
	Lock,
	LogOut,
	Mail,
	Radio,
} from "lucide-react";
import { useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { z } from "zod";
import { ApiClientError } from "../lib/api-client";
import {
	useAuthSession,
	useMyOrganizationsQuery,
	useSignInMutation,
	useSignOutMutation,
} from "../lib/auth";
import { useGsapPageReveal } from "../lib/gsap-motion";

const loginSchema = z.object({
	email: z
		.string()
		.trim()
		.min(1, "Email wajib diisi.")
		.email("Format alamat email tidak valid."),
	password: z.string().min(8, "Kata sandi minimal 8 karakter."),
});

export function LoginPage() {
	const navigate = useNavigate();
	const location = useLocation();
	const pageRef = useRef<HTMLDivElement>(null);
	const { data: sessionData, isLoading: isSessionLoading } = useAuthSession();
	const { data: orgsData } = useMyOrganizationsQuery();
	const signInMutation = useSignInMutation();
	const signOutMutation = useSignOutMutation();

	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [showPassword, setShowPassword] = useState(false);
	const [fieldErrors, setFieldErrors] = useState<{
		email?: string;
		password?: string;
	}>({});
	const [serverErrorMessage, setServerErrorMessage] = useState<string | null>(
		null,
	);

	useGsapPageReveal(pageRef, [isSessionLoading, Boolean(sessionData?.user)]);

	const rawFrom = (location.state as { from?: string } | null)?.from;
	const redirectTarget =
		rawFrom && rawFrom.startsWith("/") && !rawFrom.startsWith("//")
			? rawFrom
			: "/dashboard";

	async function handleSignInSubmit(e?: React.FormEvent) {
		if (e) e.preventDefault();
		setFieldErrors({});
		setServerErrorMessage(null);

		const parsed = loginSchema.safeParse({ email, password });
		if (!parsed.success) {
			const nextErrors: { email?: string; password?: string } = {};
			for (const issue of parsed.error.issues) {
				const key = issue.path[0] as "email" | "password";
				if (!nextErrors[key]) {
					nextErrors[key] = issue.message;
				}
			}
			setFieldErrors(nextErrors);
			return;
		}

		try {
			await signInMutation.mutateAsync({
				email: parsed.data.email,
				password: parsed.data.password,
			});
			navigate(redirectTarget);
		} catch (err) {
			if (err instanceof ApiClientError) {
				setServerErrorMessage(err.message);
			} else {
				setServerErrorMessage(
					"Gagal masuk. Periksa kembali alamat email dan kata sandi Anda.",
				);
			}
		}
	}

	const activeOrg = orgsData?.organizations?.[0];

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
			<div style={{ width: "100%", maxWidth: 460 }}>
				{/* Top back link to Home */}
				<div style={{ marginBottom: 16 }} data-gsap="reveal">
					<Link
						to="/"
						className="teduh-back-link"
						style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}
					>
						<ArrowLeft size={15} />
						<span>Kembali ke Beranda</span>
					</Link>
				</div>

				{!isSessionLoading && sessionData?.user ? (
					/* Active Session Card */
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
							gap: 20,
						}}
					>
						<div>
							<span
								style={{
									display: "inline-block",
									padding: "3px 10px",
									borderRadius: 9999,
									background: "#F0F4EB",
									color: "#4D702F",
									fontSize: 12,
									fontWeight: 600,
									marginBottom: 10,
								}}
							>
								Sesi Masuk Aktif
							</span>
							<h1
								style={{
									margin: "0 0 6px 0",
									fontSize: 24,
									fontWeight: 400,
									color: "#181B20",
									fontFamily: "var(--font-family)",
								}}
							>
								{sessionData.user.name}
							</h1>
							<p style={{ margin: 0, fontSize: 14, color: "#545B67" }}>
								{sessionData.user.email}
							</p>
						</div>

						{activeOrg && (
							<div
								style={{
									background: "#F4F4F3",
									borderRadius: 14,
									padding: "14px 16px",
									display: "flex",
									flexDirection: "column",
									gap: 4,
								}}
							>
								<span style={{ fontSize: 11.5, color: "#71717A", fontWeight: 500 }}>
									Organisasi Terdaftar
								</span>
								<span style={{ fontSize: 14, fontWeight: 600, color: "#181B20" }}>
									{activeOrg.name}
								</span>
								<span style={{ fontSize: 12, color: "#4D702F", fontWeight: 500 }}>
									Peran: {activeOrg.role === "organizer" ? "Prajuru / Pengelola Organisasi" : "Petugas Lapangan"}
								</span>
							</div>
						)}

						<div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
							<Link
								to="/dashboard"
								className="ui-button ui-button-primary"
							>
								<LayoutDashboard size={16} />
								<span>Buka Panel Panitia</span>
							</Link>

							<Link
								to="/field"
								style={{
									display: "inline-flex",
									alignItems: "center",
									justifyContent: "center",
									gap: 8,
									padding: "12px 18px",
									borderRadius: 9999,
									background: "#F4F4F3",
									color: "#181B20",
									fontSize: 14,
									fontWeight: 500,
									textDecoration: "none",
								}}
							>
								<Radio size={16} color="#4D702F" />
								<span>Buka Tugas Lapangan Pecalang</span>
							</Link>

							<button
								type="button"
								onClick={() => signOutMutation.mutate()}
								disabled={signOutMutation.isPending}
								style={{
									background: "transparent",
									border: "none",
									color: "#9E2A2B",
									padding: "10px",
									cursor: "pointer",
									fontSize: 13.5,
									fontWeight: 500,
									display: "inline-flex",
									alignItems: "center",
									justifyContent: "center",
									gap: 6,
								}}
							>
								<LogOut size={15} />
								<span>{signOutMutation.isPending ? "Keluar..." : "Keluar dari Akun"}</span>
							</button>
						</div>
					</div>
				) : (
					/* Sign In Form Card */
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
						{/* Card Header */}
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
								Masuk Petugas Desa
							</h1>
							<p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: "#545B67" }}>
								Akses khusus Prajuru Desa Adat dan Petugas Lapangan (Pecalang & Kebersihan).
							</p>
						</div>

						{/* Public Note: Citizens do not need account */}
						<div
							style={{
								background: "#F8FAF8",
								border: "1px solid rgba(92, 132, 55, 0.12)",
								borderRadius: 14,
								padding: "12px 14px",
								fontSize: 12.5,
								lineHeight: 1.5,
								color: "#545B67",
								display: "flex",
								alignItems: "flex-start",
								gap: 10,
							}}
						>
							<Compass size={16} color="#4D702F" style={{ flexShrink: 0, marginTop: 2 }} />
							<div>
								Masyarakat umum tidak perlu masuk untuk melihat peta penutupan jalan dan jadwal acara.{" "}
								<Link to="/peta" style={{ color: "#4D702F", fontWeight: 600, textDecoration: "none" }}>
									Buka Peta Kawasan →
								</Link>
							</div>
						</div>

						{/* Server Error Message */}
						{serverErrorMessage && (
							<div
								style={{
									background: "#FDF2F2",
									border: "1px solid rgba(158, 42, 43, 0.2)",
									borderRadius: 12,
									padding: "12px 14px",
									fontSize: 13,
									color: "#9E2A2B",
									lineHeight: 1.5,
								}}
							>
								{serverErrorMessage}
							</div>
						)}

						{/* Login Form */}
						<form onSubmit={handleSignInSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
							{/* Email Field */}
							<div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
								<label
									htmlFor="login-email"
									style={{ fontSize: 13, fontWeight: 500, color: "#181B20" }}
								>
									Alamat Email
								</label>
								<div
									style={{
										display: "flex",
										alignItems: "center",
										background: "#F8FAF8",
										border: fieldErrors.email
											? "1.5px solid #9E2A2B"
											: "1px solid rgba(228, 231, 229, 0.9)",
										borderRadius: 12,
										padding: "10px 14px",
										gap: 10,
									}}
								>
									<Mail size={16} color="#64748B" style={{ flexShrink: 0 }} />
									<input
										id="login-email"
										type="email"
										value={email}
										onChange={(e) => {
											setEmail(e.target.value);
											if (fieldErrors.email) setFieldErrors((p) => ({ ...p, email: undefined }));
										}}
										placeholder="prajuru@desaadatubud.id"
										autoComplete="email"
										style={{
											border: "none",
											outline: "none",
											background: "transparent",
											width: "100%",
											fontSize: 14,
											color: "#181B20",
											fontFamily: "var(--font-family)",
										}}
									/>
								</div>
								{fieldErrors.email && (
									<span style={{ fontSize: 12, color: "#9E2A2B" }}>{fieldErrors.email}</span>
								)}
							</div>

							{/* Password Field */}
							<div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
								<label
									htmlFor="login-password"
									style={{ fontSize: 13, fontWeight: 500, color: "#181B20" }}
								>
									Kata Sandi
								</label>
								<div
									style={{
										display: "flex",
										alignItems: "center",
										background: "#F8FAF8",
										border: fieldErrors.password
											? "1.5px solid #9E2A2B"
											: "1px solid rgba(228, 231, 229, 0.9)",
										borderRadius: 12,
										padding: "10px 14px",
										gap: 10,
									}}
								>
									<Lock size={16} color="#64748B" style={{ flexShrink: 0 }} />
									<input
										id="login-password"
										type={showPassword ? "text" : "password"}
										value={password}
										onChange={(e) => {
											setPassword(e.target.value);
											if (fieldErrors.password) setFieldErrors((p) => ({ ...p, password: undefined }));
										}}
										placeholder="Masukkan kata sandi"
										autoComplete="current-password"
										style={{
											border: "none",
											outline: "none",
											background: "transparent",
											width: "100%",
											fontSize: 14,
											color: "#181B20",
											fontFamily: "var(--font-family)",
										}}
									/>
									<button
										type="button"
										onClick={() => setShowPassword(!showPassword)}
										style={{ background: "none", border: "none", color: "#64748B", cursor: "pointer", padding: 2 }}
										aria-label={showPassword ? "Sembunyikan kata sandi" : "Tampilkan kata sandi"}
									>
										{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
									</button>
								</div>
								{fieldErrors.password && (
									<span style={{ fontSize: 12, color: "#9E2A2B" }}>{fieldErrors.password}</span>
								)}
							</div>

							{/* Submit Button */}
							<button
								type="submit"
								disabled={signInMutation.isPending}
								style={{
									marginTop: 6,
									background: "#4D702F",
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
									cursor: signInMutation.isPending ? "not-allowed" : "pointer",
									opacity: signInMutation.isPending ? 0.75 : 1,
									transition: "all var(--transition-fast)",
								}}
							>
								<KeyRound size={16} />
								<span>{signInMutation.isPending ? "Memverifikasi..." : "Masuk ke Panel"}</span>
							</button>
						</form>

						{/* Register & Onboarding Links per message (2).txt */}
						<div
							style={{
								paddingTop: 16,
								borderTop: "1px solid #F1F2F4",
								display: "flex",
								flexDirection: "column",
								gap: 12,
								textAlign: "center",
							}}
						>
							<div style={{ fontSize: 13.5, color: "#545B67" }}>
								Belum memiliki akun petugas?{" "}
								<Link
									to="/register"
									style={{
										color: "#4D702F",
										fontWeight: 600,
										textDecoration: "none",
									}}
								>
									Daftar Akun Baru
								</Link>
							</div>

							<div style={{ fontSize: 12.5, color: "#71717A" }}>
								Menerima tautan undangan dari panitia? Buka tautan langsung untuk bergabung.
							</div>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
