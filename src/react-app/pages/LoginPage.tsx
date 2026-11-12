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
					<Link to="/" className="teduh-back-link">
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
							border: "1px solid var(--color-border)",
							borderRadius: 4,
							padding: "28px 24px",
							display: "flex",
							flexDirection: "column",
							gap: 20,
						}}
					>
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
								Sesi Masuk Aktif
							</span>
							<h1
								style={{
									margin: "0 0 6px 0",
									fontSize: "1.625rem",
									fontWeight: 600,
									color: "#181B20",
									fontFamily: "var(--font-sans)",
								}}
							>
								{sessionData.user.name}
							</h1>
							<p style={{ margin: 0, fontSize: "1rem", color: "#545B67" }}>
								{sessionData.user.email}
							</p>
						</div>

						{activeOrg && (
							<div
								style={{
									background: "#FFFFFF",
									border: "1px solid var(--color-border)",
									borderRadius: 4,
									padding: "14px 16px",
									display: "flex",
									flexDirection: "column",
									gap: 4,
								}}
							>
								<span style={{ fontSize: "0.875rem", color: "#545B67", fontWeight: 600 }}>
									Organisasi Terdaftar
								</span>
								<span style={{ fontSize: "1rem", fontWeight: 600, color: "#181B20" }}>
									{activeOrg.name}
								</span>
								<span style={{ fontSize: "0.9375rem", color: "#4D702F", fontWeight: 600 }}>
									Peran: {activeOrg.role === "organizer" ? "Prajuru / Pengelola Organisasi" : "Petugas Lapangan"}
								</span>
							</div>
						)}

						<div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
							<Link
								to="/dashboard"
								className="ui-button ui-button-primary"
								style={{ gap: 8 }}
							>
								<LayoutDashboard size={16} />
								<span>Buka Panel Panitia</span>
							</Link>

							<Link
								to="/field"
								className="ui-button"
								style={{ gap: 8 }}
							>
								<Radio size={16} color="#4D702F" />
								<span>Buka Tugas Lapangan Pecalang</span>
							</Link>

							<button
								type="button"
								onClick={() => signOutMutation.mutate()}
								disabled={signOutMutation.isPending}
								className="ui-button"
								style={{
									color: "#B91C1C",
									borderColor: "var(--color-border)",
									gap: 6,
								}}
							>
								<LogOut size={15} />
								<span>{signOutMutation.isPending ? "Keluar..." : "Keluar dari Akun"}</span>
							</button>
							{signOutMutation.isError ? (
								<p role="alert" style={{ color: "#B91C1C", fontSize: "1rem", margin: 0 }}>
									Tidak dapat keluar. Periksa koneksi dan coba lagi.
								</p>
							) : null}
						</div>
					</div>
				) : (
					/* Sign In Form Card */
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
						{/* Card Header */}
						<div>
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
								Masuk Petugas Desa
							</h1>
							<p style={{ margin: 0, fontSize: "1rem", lineHeight: 1.6, color: "#545B67" }}>
								Akses khusus Prajuru Desa Adat dan Petugas Lapangan (Pecalang & Kebersihan).
							</p>
						</div>

						{/* Public Note: Citizens do not need account */}
						<div
							style={{
								background: "#FFFFFF",
								border: "1px solid var(--color-border)",
								borderRadius: 4,
								padding: "12px 14px",
								fontSize: "1rem",
								lineHeight: 1.5,
								color: "#545B67",
								display: "flex",
								alignItems: "flex-start",
								gap: 10,
							}}
						>
							<Compass size={16} color="#4D702F" style={{ flexShrink: 0, marginTop: 3 }} />
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
								role="alert"
								style={{
									background: "#FFFFFF",
									border: "1px solid #B91C1C",
									borderRadius: 4,
									padding: "12px 14px",
									fontSize: "1rem",
									color: "#B91C1C",
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
									style={{ fontSize: "1rem", fontWeight: 600, color: "#181B20" }}
								>
									Alamat Email
								</label>
								<div
									style={{
										display: "flex",
										alignItems: "center",
										background: "#FFFFFF",
										border: fieldErrors.email
											? "1.5px solid #B91C1C"
											: "1px solid var(--color-border)",
										borderRadius: 4,
										minHeight: 48,
										padding: "0 14px",
										gap: 10,
									}}
								>
									<Mail size={16} color="#545B67" style={{ flexShrink: 0 }} />
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
											fontSize: "1rem",
											color: "#181B20",
											fontFamily: "var(--font-sans)",
										}}
									/>
								</div>
								{fieldErrors.email && (
									<span style={{ fontSize: "0.9375rem", color: "#B91C1C" }}>{fieldErrors.email}</span>
								)}
							</div>

							{/* Password Field */}
							<div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
								<label
									htmlFor="login-password"
									style={{ fontSize: "1rem", fontWeight: 600, color: "#181B20" }}
								>
									Kata Sandi
								</label>
								<div
									style={{
										display: "flex",
										alignItems: "center",
										background: "#FFFFFF",
										border: fieldErrors.password
											? "1.5px solid #B91C1C"
											: "1px solid var(--color-border)",
										borderRadius: 4,
										minHeight: 48,
										padding: "0 14px",
										gap: 10,
									}}
								>
									<Lock size={16} color="#545B67" style={{ flexShrink: 0 }} />
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
											fontSize: "1rem",
											color: "#181B20",
											fontFamily: "var(--font-sans)",
										}}
									/>
									<button
										type="button"
										onClick={() => setShowPassword(!showPassword)}
										style={{
											background: "none",
											border: "none",
											color: "#545B67",
											cursor: "pointer",
											padding: 4,
											display: "inline-flex",
											alignItems: "center",
										}}
										aria-label={showPassword ? "Sembunyikan kata sandi" : "Tampilkan kata sandi"}
									>
										{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
									</button>
								</div>
								{fieldErrors.password && (
									<span style={{ fontSize: "0.9375rem", color: "#B91C1C" }}>{fieldErrors.password}</span>
								)}
							</div>

							{/* Submit Button */}
							<button
								type="submit"
								disabled={signInMutation.isPending}
								className="ui-button ui-button-primary"
								style={{
									marginTop: 4,
									gap: 8,
									cursor: signInMutation.isPending ? "not-allowed" : "pointer",
									opacity: signInMutation.isPending ? 0.75 : 1,
								}}
							>
								<KeyRound size={16} />
								<span>{signInMutation.isPending ? "Memverifikasi..." : "Masuk ke Panel"}</span>
							</button>
						</form>

						{/* Register & Onboarding Links */}
						<div
							style={{
								paddingTop: 16,
								borderTop: "1px solid var(--color-border)",
								display: "flex",
								flexDirection: "column",
								gap: 10,
								textAlign: "center",
							}}
						>
							<div style={{ fontSize: "1rem", color: "#545B67" }}>
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

							<div style={{ fontSize: "0.9375rem", color: "#545B67" }}>
								Menerima tautan undangan dari panitia? Buka tautan langsung untuk bergabung.
							</div>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
