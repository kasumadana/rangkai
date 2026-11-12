import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { User, ChevronDown } from "lucide-react";
import { useAuthSession, useMyOrganizationsQuery, useSignOutMutation } from "../../lib/auth";
import { getSavedOrganizationId, saveOrganizationId } from "../../lib/events-api";

export function ProfileMenu() {
	const [open, setOpen] = useState(false);
	const [error, setError] = useState("");
	const [pending, setPending] = useState(false);
	const [orgId, setOrgId] = useState(getSavedOrganizationId);
	const trigger = useRef<HTMLButtonElement>(null);
	const root = useRef<HTMLDivElement>(null);
	const { data: session } = useAuthSession();
	const organizations = useMyOrganizationsQuery();
	const signOut = useSignOutMutation();

	useEffect(() => {
		const changed = () => setOrgId(getSavedOrganizationId());
		window.addEventListener("rangkai:organization-changed", changed);
		return () => window.removeEventListener("rangkai:organization-changed", changed);
	}, []);

	useEffect(() => {
		if (!open) return;
		const focusable = () => Array.from(root.current?.querySelectorAll<HTMLElement>('.profile-popover a[href], .profile-popover button:not(:disabled), .profile-popover select:not(:disabled)') || []);
		focusable()[0]?.focus();
		const key = (event: KeyboardEvent) => {
			if (event.key === "Escape") { event.preventDefault(); setOpen(false); trigger.current?.focus(); return; }
			if (event.key !== "Tab") return;
			const items = focusable();
			if (!items.length) return;
			if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items[items.length - 1].focus(); }
			else if (!event.shiftKey && document.activeElement === items[items.length - 1]) { event.preventDefault(); items[0].focus(); }
		};
		const outside = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
		document.addEventListener("keydown", key); document.addEventListener("mousedown", outside);
		return () => { document.removeEventListener("keydown", key); document.removeEventListener("mousedown", outside); };
	}, [open]);

	const items = organizations.data?.organizations || [];
	const active = items.find(org => org.id === orgId) || items.find(org => org.role === "organizer") || items[0];

	async function logout() {
		setPending(true); setError("");
		try {
			await signOut.mutateAsync();
			setOpen(false);
		} catch { setError("Tidak dapat keluar. Periksa koneksi dan coba lagi."); }
		finally { setPending(false); }
	}

	const isUserLoggedIn = Boolean(session?.user);
	const displayName = session?.user?.name || (isUserLoggedIn ? "Profil" : "Akun");

	return (
		<div className="profile-menu" ref={root}>
			<button
				ref={trigger}
				type="button"
				className={`profile-trigger ${open ? "is-active" : ""}`}
				aria-expanded={open}
				aria-controls="profile-menu"
				aria-haspopup="true"
				onClick={() => setOpen(!open)}
			>
				<User size={16} aria-hidden="true" className="profile-trigger-icon" />
				<span className="profile-trigger-label">{displayName}</span>
				<ChevronDown size={14} aria-hidden="true" className={`profile-trigger-chevron ${open ? "is-open" : ""}`} />
			</button>
			{open && (
				<div id="profile-menu" className="profile-popover" role="region" aria-label="Menu akun">
					{session?.user ? (
						<>
							<div className="profile-popover-header">
								<strong className="profile-popover-name">{session.user.name}</strong>
								<p className="profile-popover-email">{session.user.email}</p>
								{active && (
									<div className="profile-popover-badge">
										<span>{active.name}</span>
										<span className="profile-role-tag">{active.role === "organizer" ? "Panitia" : "Petugas"}</span>
									</div>
								)}
							</div>
							{items.length > 1 && (
								<div className="profile-popover-field">
									<label htmlFor="profile-org-select">Organisasi Aktif</label>
									<select
										id="profile-org-select"
										value={active?.id || ""}
										onChange={e => {
											if (items.some(org => org.id === e.target.value)) saveOrganizationId(e.target.value);
										}}
									>
										{items.map(org => (
											<option key={org.id} value={org.id}>{org.name}</option>
										))}
									</select>
								</div>
							)}
							<div className="profile-popover-nav">
								<Link to={active?.role === "officer" ? "/field" : "/dashboard"} onClick={() => setOpen(false)}>
									Ruang kerja
								</Link>
								<Link to="/" onClick={() => setOpen(false)}>
									Portal publik
								</Link>
								<Link to="/settings" onClick={() => setOpen(false)}>
									Pengaturan
								</Link>
							</div>
							<div className="profile-popover-footer">
								<button type="button" className="profile-logout-btn" disabled={pending} onClick={() => void logout()}>
									{pending ? "Sedang keluar..." : "Keluar"}
								</button>
								{error && <p className="profile-error-alert" role="alert">{error}</p>}
							</div>
						</>
					) : (
						<div className="profile-popover-nav">
							<Link to="/login" onClick={() => setOpen(false)}>
								Masuk
							</Link>
							<Link to="/register" onClick={() => setOpen(false)}>
								Daftar
							</Link>
						</div>
					)}
				</div>
			)}
		</div>
	);
}
