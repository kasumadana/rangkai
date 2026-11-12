import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router";
import { ApiClientError } from "../../lib/api-client";
import { fetchActiveSession } from "../../lib/auth";

export function RequireSession() {
	const { pathname } = useLocation();
	const client = useQueryClient();
	const [clock, setClock] = useState(() => Date.now());
	const [signedOutElsewhere, setSignedOutElsewhere] = useState(false);
	const session = useQuery({ queryKey: ["auth", "route-session", pathname], queryFn: fetchActiveSession, retry: false, staleTime: 0, refetchOnMount: "always", refetchOnWindowFocus: true });
	const { refetch } = session;
	useEffect(() => {
		const refresh = () => { if (document.visibilityState === "visible") { setClock(Date.now()); void client.invalidateQueries({ queryKey: ["auth", "route-session"] }); } };
		const storage = (event: StorageEvent) => { if (event.key === "rangkai:session-changed") { setSignedOutElsewhere(true); void client.cancelQueries(); client.clear(); window.dispatchEvent(new Event("rangkai:session-changed")); } };
		window.addEventListener("pageshow", refresh);
		document.addEventListener("visibilitychange", refresh);
		window.addEventListener("storage", storage);
		return () => { window.removeEventListener("pageshow", refresh); document.removeEventListener("visibilitychange", refresh); window.removeEventListener("storage", storage); };
	}, [client]);
	const expiresAt = Date.parse(session.data?.session.expiresAt ?? "");
	useEffect(() => {
		if (!Number.isFinite(expiresAt)) return;
		const timer = window.setTimeout(() => { setClock(Date.now()); void refetch(); }, Math.max(0, Math.min(expiresAt - Date.now() + 1, 2147483647)));
		return () => window.clearTimeout(timer);
	}, [expiresAt, refetch]);
	if (signedOutElsewhere) return <Navigate to="/" replace />;
	if (session.isFetching || session.isPending) return <main className="teduh-page-shell" role="status">Memeriksa sesi...</main>;
	if (session.isError && !(session.error instanceof ApiClientError && session.error.status === 401)) return <main className="teduh-page-shell" role="alert"><p>Sesi belum dapat diperiksa. Periksa koneksi dan coba lagi.</p><button type="button" className="teduh-btn-secondary" onClick={() => void session.refetch()}>Coba lagi</button></main>;
	if (!session.data?.user || !Number.isFinite(expiresAt) || expiresAt <= clock) return <Navigate to="/" replace />;
	return <Outlet />;
}
