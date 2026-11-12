import { Inbox, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { ApiClientError } from "../../lib/api-client";

export function LoadingStateBlock({ label = "Memuat data operasional...", rows = 3 }: { label?: string; rows?: number }) {
	return <section className="rounded-xl bg-stone-50 p-5" role="status" aria-live="polite">
		<p>{label}</p>
		<div aria-hidden="true" className="mt-4 grid gap-2">
			{Array.from({ length: rows }, (_, index) => <span key={index} className={`block h-4 rounded bg-stone-200 ${index === rows - 1 ? "w-2/3" : "w-full"}`} />)}
		</div>
	</section>;
}

export function ErrorStateBanner({ title = "Data belum dapat dimuat", error, onRetry, fallbackAction }: {
	title?: string; error?: unknown; onRetry?: () => void; fallbackAction?: ReactNode;
}) {
	const message = error instanceof ApiClientError
		? `${error.message} (Kode: ${error.code}, ID: ${error.requestId})`
		: error instanceof Error ? error.message : "Terjadi gangguan komunikasi dengan server. Silakan coba lagi.";
	return <section className="rounded-xl bg-red-50 p-4 text-red-900" role="alert">
		<strong>{title}</strong><p>{message}</p>
		{onRetry || fallbackAction ? <div className="mt-3 flex flex-wrap items-center gap-2">
			{onRetry ? <button type="button" className="teduh-btn-secondary" onClick={onRetry}><RefreshCw size={16} aria-hidden="true" /> Coba Lagi</button> : null}
			{fallbackAction}
		</div> : null}
	</section>;
}

export function EmptyStateCard({ title, description, icon, actions }: {
	title: string; description?: string; icon?: ReactNode; actions?: ReactNode;
}) {
	return <section className="rounded-xl bg-stone-50 p-6 text-center">
		<div className="mb-3 flex justify-center" aria-hidden="true">{icon ?? <Inbox size={24} />}</div>
		<h3 className="font-semibold">{title}</h3>
		{description ? <p className="mt-2 text-stone-600">{description}</p> : null}
		{actions ? <div className="mt-4">{actions}</div> : null}
	</section>;
}
