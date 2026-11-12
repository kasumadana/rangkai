import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../lib/api-client";
import { useAuthSession } from "../lib/auth";
import { saveOrganizationId } from "../lib/events-api";

type ActivationDetails = { valid: true; invitation: { recipientEmail: string; role: "organizer" | "officer" | "government_reviewer"; expiresAt: string; organizationName: string | null; eventTitle: string | null; canUpdateTraffic: boolean; canUpdateCleanup: boolean } };
type AcceptedActivation = { success: true; role: "organizer" | "officer" | "government_reviewer"; organizationId: string | null; eventId: string | null };

const labels = { organizer: "Organizer", officer: "Petugas lapangan", government_reviewer: "Reviewer pemerintah" } as const;

export function ActivationPage() {
	const token = useParams().token || "";
	const path = `/activate/${encodeURIComponent(token)}`;
	const navigate = useNavigate();
	const client = useQueryClient();
	const session = useAuthSession();
	const [errorMessage, setErrorMessage] = useState("");
	const [noticeMessage, setNoticeMessage] = useState("");
	const invitation = useQuery({ queryKey: ["activation", token], queryFn: () => apiFetch<ActivationDetails>(`/api/activation-invitations/${encodeURIComponent(token)}`), enabled: Boolean(token), retry: false });
	const accept = useMutation({ mutationFn: () => apiFetch<AcceptedActivation>(`/api/activation-invitations/${encodeURIComponent(token)}/accept`, { method: "POST", body: {} }), onSuccess: async result => {
		await client.invalidateQueries({ queryKey: ["auth", "session"] });
		if (result.organizationId) saveOrganizationId(result.organizationId);
		if (result.role === "organizer") navigate("/dashboard", { replace: true });
		else if (result.role === "officer" && result.eventId) navigate(`/field/events/${result.eventId}`, { replace: true });
		else if (result.role === "officer") navigate("/field", { replace: true });
		else setNoticeMessage("Undangan diterima. Superadmin perlu menetapkan wilayah tugas reviewer sebelum antrean tinjauan tersedia.");
	} });

	const targetEmail = invitation.data?.invitation.recipientEmail.toLowerCase();
	const currentEmail = session.data?.user?.email.toLowerCase();
	const mismatch = Boolean(targetEmail && currentEmail && targetEmail !== currentEmail);
	const invitationState = { email: invitation.data?.invitation.recipientEmail, from: path };

	return <main className="teduh-page-shell"><section className="teduh-auth-card" style={{ width: "100%", maxWidth: 560, margin: "0 auto", padding: 24 }}>
		{invitation.isLoading || session.isLoading ? <p role="status">Memeriksa tautan aktivasi...</p> : invitation.isError || !invitation.data?.valid ? <><h1>Tautan tidak berlaku</h1><p role="alert">Tautan mungkin sudah dicabut, dipakai, atau kedaluwarsa. Hubungi superadmin untuk meminta tautan baru.</p><Link to="/">Kembali ke beranda</Link></> : <>
			<h1>Aktivasi akses Rangkai</h1>
			<p>Undangan untuk <strong>{invitation.data.invitation.recipientEmail}</strong> sebagai <strong>{labels[invitation.data.invitation.role]}</strong>.</p>
			{invitation.data.invitation.organizationName && <p>Organisasi: {invitation.data.invitation.organizationName}</p>}
			{invitation.data.invitation.eventTitle && <p>Kegiatan: {invitation.data.invitation.eventTitle}</p>}
			{invitation.data.invitation.role === "officer" && <p>Izin tugas: {[invitation.data.invitation.canUpdateTraffic && "pembaruan jalan", invitation.data.invitation.canUpdateCleanup && "laporan kebersihan"].filter(Boolean).join(" dan ")}.</p>}
			<p>Tautan berlaku sampai {new Date(invitation.data.invitation.expiresAt).toLocaleString("id-ID", { timeZone: "Asia/Makassar" })} WITA. Aktivasi tidak menerbitkan izin penutupan jalan resmi.</p>
			{mismatch ? <div role="alert"><p>Masuk dengan alamat email undangan. Sesi aktif memakai {session.data?.user?.email}.</p><Link to="/login" state={invitationState}>Ganti akun</Link></div> : accept.isSuccess ? <p role="status">Akses berhasil diaktifkan.</p> : session.data?.user ? <button className="ui-button ui-button-primary" type="button" disabled={accept.isPending} onClick={() => { setErrorMessage(""); setNoticeMessage(""); accept.mutate(); }}>{accept.isPending ? "Mengaktifkan..." : "Terima undangan"}</button> : <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}><Link className="ui-button ui-button-primary" to="/register" state={invitationState}>Buat akun dan aktifkan</Link><Link className="ui-button" to="/login" state={invitationState}>Sudah punya akun? Masuk</Link></div>}
			{noticeMessage && <p role="status">{noticeMessage}</p>}
			{(errorMessage || accept.isError) && <p role="alert">{errorMessage || accept.error?.message || "Aktivasi belum berhasil. Coba lagi."}</p>}
		</>}
	</section></main>;
}
