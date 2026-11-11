import {
	ArrowLeft,
	ArrowRight,
	CheckCircle2,
	Eye,
	EyeOff,
	Lock,
	Mail,
	PlusCircle,
	ShieldCheck,
	User,
	UserPlus,
} from "lucide-react";
import { useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import { z } from "zod";
import { ApiClientError } from "../lib/api-client";
import { useAuthSession, useSignUpMutation } from "../lib/auth";
import { useGsapPageReveal } from "../lib/gsap-motion";

const registerSchema = z
	.object({
		name: z
			.string()
			.trim()
			.min(2, "Nama lengkap minimal 2 karakter.")
			.max(100, "Nama maksimal 100 karakter."),
		email: z
			.string()
			.trim()
			.min(1, "Alamat email wajib diisi.")
			.email("Format alamat email tidak valid."),
		password: z.string().min(8, "Kata sandi minimal 8 karakter."),
		confirmPassword: z.string().min(8, "Konfirmasi kata sandi minimal 8 karakter."),
	})
	.refine((data) => data.password === data.confirmPassword, {
		message: "Konfirmasi kata sandi tidak cocok.",
		path: ["confirmPassword"],
	});

export function RegisterPage() {
	const pageRef = useRef<HTMLDivElement>(null);
	const location = useLocation();
	const { data: sessionData } = useAuthSession();
	const signUpMutation = useSignUpMutation();

	const stateObj = location.state as { email?: string; from?: string } | null;
	const initialEmail = stateObj?.email || "";
	const rawReturn = stateObj?.from;
	const safeReturnUrl =
		rawReturn && rawReturn.startsWith("/") && !rawReturn.startsWith("//")
			? rawReturn
			: null;

	const [name, setName] = useState("");
	const [email, setEmail] = useState(initialEmail);
	const [password, setPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [showPassword, setShowPassword] = useState(false);
	const [fieldErrors, setFieldErrors] = useState<{
		name?: string;
		email?: string;
		password?: string;
		confirmPassword?: string;
	}>({});
	const [serverErrorMessage, setServerErrorMessage] = useState<string | null>(
		null,
	);
	const [registrationSuccess, setRegistrationSuccess] = useState(false);

	useGsapPageReveal(pageRef, [registrationSuccess, Boolean(sessionData?.user)]);

	async function handleRegisterSubmit(e: React.FormEvent) {
		e.preventDefault();
		setFieldErrors({});
		setServerErrorMessage(null);

		const parsed = registerSchema.safeParse({
			name,
			email,
			password,
			confirmPassword,
		});

		if (!parsed.success) {
			const nextErrors: typeof fieldErrors = {};
			for (const issue of parsed.error.issues) {
				const key = issue.path[0] as keyof typeof fieldErrors;
				if (!nextErrors[key]) {
					nextErrors[key] = issue.message;
				}
			}
			setFieldErrors(nextErrors);
			return;
		}

		try {
			await signUpMutation.mutateAsync({
				name: parsed.data.name,
				email: parsed.data.email,
				password: parsed.data.password,
			});
			setRegistrationSuccess(true);
		} catch (err) {
			if (err instanceof ApiClientError) {
				setServerErrorMessage(err.message);
			} else {
				setServerErrorMessage(
					"Gagal mendaftarkan akun. Email mungkin sudah terdaftar atau format data belum sesuai.",
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
			<div style={{ width: "100%", maxWidth: 480 }}>
				{/* Top back link to Login or Home */}
				<div style={{ marginBottom: 16 }} data-gsap="reveal">
					<Link
						to="/login"
						className="teduh-back-link"
						style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: "1rem" }}
					>
						<ArrowLeft size={15} />
						<span>Kembali ke Halaman Masuk</span>
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
					{registrationSuccess || sessionData?.user ? (
						/* Registration Success & Onboarding Next Steps */
						<div style={{ display: "flex", flexDirection: "column", gap: 20, textAlign: "center" }}>
							<div
								style={{
									width: 48,
									height: 48,
									borderRadius: "50%",
									background: "#ECF3EF",
									color: "#264D3B",
									display: "flex",
									alignItems: "center",
									justifyContent: "center",
									margin: "0 auto",
								}}
							>
								<CheckCircle2 size={24} />
							</div>

							<div>
								<h1
									style={{
										margin: "0 0 8px 0",
										fontSize: 24,
										fontWeight: 400,
										color: "#181B20",
										fontFamily: "var(--font-family)",
									}}
								>
									Pendaftaran Akun Berhasil
								</h1>
								<p style={{ margin: 0, fontSize: "1rem", lineHeight: 1.6, color: "#545B67" }}>
									Identitas akun Anda telah terdaftar. Pilih langkah berikutnya sesuai kebutuhan Anda:
								</p>
							</div>

							<div style={{ display: "flex", flexDirection: "column", gap: 12, textAlign: "left" }}>
								{safeReturnUrl ? (
									<div
										style={{
											background: "#ECF3EF",
											border: "1px solid rgba(38, 77, 59, 0.3)",
											borderRadius: 16,
											padding: "16px 18px",
											display: "flex",
											flexDirection: "column",
											gap: 8,
										}}
									>
										<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
											<CheckCircle2 size={18} color="#264D3B" />
											<span style={{ fontSize: "1rem", fontWeight: 600, color: "#181B20" }}>
												Kembali ke Tautan Undangan Anda
											</span>
										</div>
										<p style={{ margin: 0, fontSize: "1rem", lineHeight: 1.5, color: "#545B67" }}>
											Akun Anda telah aktif dan siap menerima hak penugasan resmi.
										</p>
										<Link
											to={safeReturnUrl}
											className="teduh-pill-action"
											style={{ alignSelf: "flex-start", marginTop: 4, padding: "8px 16px", fontSize: "1rem" }}
										>
											<span>Buka Undangan & Konfirmasi Hak Akses</span>
											<ArrowRight size={14} />
										</Link>
									</div>
								) : null}

								{/* Option 1: Buat Organisasi Baru */}
								<div
									style={{
										background: "var(--color-surface)",
										border: "1px solid rgba(38, 77, 59, 0.15)",
										borderRadius: 16,
										padding: "16px 18px",
										display: "flex",
										flexDirection: "column",
										gap: 8,
									}}
								>
									<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
										<PlusCircle size={18} color="#264D3B" />
										<span style={{ fontSize: "1rem", fontWeight: 600, color: "#181B20" }}>
											Saya Prajuru / Penyelenggara Baru
										</span>
									</div>
									<p style={{ margin: 0, fontSize: "1rem", lineHeight: 1.5, color: "#545B67" }}>
										Daftarkan profil desa adat Anda. Anda otomatis menjadi Organizer untuk mengelola kegiatan dan mengundang petugas.
									</p>
									<Link
										to="/onboarding/organization"
										className="teduh-pill-action"
										style={{ alignSelf: "flex-start", marginTop: 4, padding: "8px 16px", fontSize: "1rem" }}
									>
										<span>Buat Organisasi Desa Adat</span>
										<ArrowRight size={14} />
									</Link>
								</div>

								{/* Option 2: Petugas dari Undangan */}
								<div
									style={{
										background: "#FFFFFF",
										border: "1px solid #E4E7E5",
										borderRadius: 16,
										padding: "16px 18px",
										display: "flex",
										flexDirection: "column",
										gap: 6,
									}}
								>
									<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
										<ShieldCheck size={18} color="#64748B" />
										<span style={{ fontSize: "1rem", fontWeight: 600, color: "#181B20" }}>
											Saya Petugas Lapangan (Pecalang / Kebersihan)
										</span>
									</div>
									<p style={{ margin: 0, fontSize: "1rem", lineHeight: 1.5, color: "#545B67" }}>
										Silakan buka tautan undangan resmi yang dikirimkan oleh Prajuru / Organizer Anda melalui WhatsApp untuk otomatis bergabung.
									</p>
									<Link
										to="/dashboard"
										style={{
											alignSelf: "flex-start",
											marginTop: 4,
											fontSize: "1rem",
											color: "#264D3B",
											fontWeight: 600,
											textDecoration: "none",
										}}
									>
										Buka Beranda Akun →
									</Link>
								</div>
							</div>
						</div>
					) : (
						/* Registration Form */
						<>
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
									Daftar Akun Petugas
								</h1>
								<p style={{ margin: 0, fontSize: "1rem", lineHeight: 1.6, color: "#545B67" }}>
									Registrasi identitas untuk Prajuru Desa Adat dan Petugas Lapangan.
								</p>
							</div>

							{/* Role rule clarification per message (2).txt */}
							<div
								style={{
									background: "var(--color-surface)",
									border: "1px solid rgba(38, 77, 59, 0.12)",
									borderRadius: 14,
									padding: "12px 14px",
									fontSize: "1rem",
									lineHeight: 1.5,
									color: "#545B67",
								}}
							>
								<strong>Catatan Peran:</strong> Anda tidak perlu memilih peran saat mendaftar. Hak akses sebagai <em>Organizer</em> atau <em>Petugas Lapangan</em> ditentukan setelah Anda membuat organisasi atau menerima tautan undangan resmi.
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

							<form onSubmit={handleRegisterSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
								{/* Name */}
								<div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
									<label htmlFor="reg-name" style={{ fontSize: "1rem", fontWeight: 500, color: "#181B20" }}>
										Nama Lengkap
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
										<User size={16} color="#64748B" style={{ flexShrink: 0 }} />
										<input
											id="reg-name"
											type="text"
											value={name}
											onChange={(e) => {
												setName(e.target.value);
												if (fieldErrors.name) setFieldErrors((p) => ({ ...p, name: undefined }));
											}}
											placeholder="Contoh: I Made Wirawan"
											autoComplete="name"
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

								{/* Email */}
								<div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
									<label htmlFor="reg-email" style={{ fontSize: "1rem", fontWeight: 500, color: "#181B20" }}>
										Alamat Email
									</label>
									<div
										style={{
											display: "flex",
											alignItems: "center",
											background: "var(--color-surface)",
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
											id="reg-email"
											type="email"
											value={email}
											onChange={(e) => {
												setEmail(e.target.value);
												if (fieldErrors.email) setFieldErrors((p) => ({ ...p, email: undefined }));
											}}
											placeholder="nama@email.com"
											autoComplete="email"
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
									{fieldErrors.email && (
										<span style={{ fontSize: "1rem", color: "#9E2A2B" }}>{fieldErrors.email}</span>
									)}
								</div>

								{/* Password */}
								<div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
									<label htmlFor="reg-password" style={{ fontSize: "1rem", fontWeight: 500, color: "#181B20" }}>
										Kata Sandi (Minimal 8 karakter)
									</label>
									<div
										style={{
											display: "flex",
											alignItems: "center",
											background: "var(--color-surface)",
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
											id="reg-password"
											type={showPassword ? "text" : "password"}
											value={password}
											onChange={(e) => {
												setPassword(e.target.value);
												if (fieldErrors.password) setFieldErrors((p) => ({ ...p, password: undefined }));
											}}
											placeholder="Buat kata sandi aman"
											autoComplete="new-password"
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
										<button
											type="button"
											onClick={() => setShowPassword(!showPassword)}
											style={{ background: "none", border: "none", color: "#64748B", cursor: "pointer", padding: 2 }}
										>
											{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
										</button>
									</div>
									{fieldErrors.password && (
										<span style={{ fontSize: "1rem", color: "#9E2A2B" }}>{fieldErrors.password}</span>
									)}
								</div>

								{/* Confirm Password */}
								<div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
									<label htmlFor="reg-confirm" style={{ fontSize: "1rem", fontWeight: 500, color: "#181B20" }}>
										Konfirmasi Kata Sandi
									</label>
									<div
										style={{
											display: "flex",
											alignItems: "center",
											background: "var(--color-surface)",
											border: fieldErrors.confirmPassword
												? "1.5px solid #9E2A2B"
												: "1px solid rgba(228, 231, 229, 0.9)",
											borderRadius: 12,
											padding: "10px 14px",
											gap: 10,
										}}
									>
										<Lock size={16} color="#64748B" style={{ flexShrink: 0 }} />
										<input
											id="reg-confirm"
											type={showPassword ? "text" : "password"}
											value={confirmPassword}
											onChange={(e) => {
												setConfirmPassword(e.target.value);
												if (fieldErrors.confirmPassword) {
													setFieldErrors((p) => ({ ...p, confirmPassword: undefined }));
												}
											}}
											placeholder="Ulangi kata sandi"
											autoComplete="new-password"
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
									{fieldErrors.confirmPassword && (
										<span style={{ fontSize: "1rem", color: "#9E2A2B" }}>{fieldErrors.confirmPassword}</span>
									)}
								</div>

								{/* Submit Button */}
								<button
									type="submit"
									disabled={signUpMutation.isPending}
									style={{
										marginTop: 6,
										background: "#264D3B",
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
										cursor: signUpMutation.isPending ? "not-allowed" : "pointer",
										opacity: signUpMutation.isPending ? 0.75 : 1,
										transition: "all var(--transition-fast)",
									}}
								>
									<UserPlus size={16} />
									<span>{signUpMutation.isPending ? "Mendaftarkan Akun..." : "Daftar Akun Baru"}</span>
								</button>
							</form>

							<div
								style={{
									paddingTop: 16,
									borderTop: "1px solid #F1F2F4",
									textAlign: "center",
									fontSize: "1rem",
									color: "#545B67",
								}}
							>
								Sudah memiliki akun?{" "}
								<Link
									to="/login"
									style={{
										color: "#264D3B",
										fontWeight: 600,
										textDecoration: "none",
									}}
								>
									Masuk di sini
								</Link>
							</div>
						</>
					)}
				</div>
			</div>
		</div>
	);
}
