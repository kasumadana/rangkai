import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { EmptyStateCard, ErrorStateBanner, LoadingStateBlock } from "../components/rangkai";
import { fetchFieldTasks } from "../lib/events-api";
import { formatWitaRange } from "../lib/wita";

export function FieldTaskListPage() {
	const { data, isLoading, isError, error, refetch } = useQuery({
		queryKey: ["field", "tasks"], queryFn: fetchFieldTasks, staleTime: 15_000, retry: false,
	});
	const assignments = data?.assignments ?? [];
	return <section className="field-task-list-page mx-auto flex w-full max-w-3xl flex-col gap-5">
		<header>
			<h1 className="text-2xl font-semibold text-stone-900">Tugas lapangan</h1>
			<p className="mt-2 text-stone-600">Pilih kegiatan untuk melihat tugas yang diberikan kepada Anda.</p>
		</header>
		<section className="rounded border border-stone-300 p-4 text-stone-700" aria-label="Informasi tugas lapangan">
			<p>Status jalan yang kedaluwarsa perlu diperbarui petugas. Rangkai tidak menggantikan wewenang kepolisian atau Dishub.</p>
		</section>
		{isLoading ? <LoadingStateBlock label="Memuat daftar penugasan lapangan..." rows={3} /> : isError ?
			<ErrorStateBanner title="Gagal Memuat Penugasan" error={error} onRetry={() => void refetch()} fallbackAction={<Link className="teduh-btn-primary" to="/login">Masuk Akun Petugas</Link>} /> :
			assignments.length === 0 ? <EmptyStateCard title="Belum Ada Penugasan Kegiatan" description="Anda belum terdaftar dalam penugasan Pos Pecalang maupun Kebersihan pada kegiatan manapun. Hubungi Prajuru Desa Adat Anda untuk menerima tautan undangan tugas lapangan." actions={<Link className="teduh-btn-secondary" to="/events">Lihat Jadwal Upacara Se-Bali</Link>} /> :
			<ul className="field-task-list m-0 list-none p-0">
				{assignments.map((task) => <li key={`${task.eventId}-${task.assignmentId ?? "oversight"}`} className="field-task-card flex flex-wrap items-start gap-3 py-4">
					<div className="min-w-0 flex-1">
						<div className="flex flex-wrap items-center gap-2"><strong>{task.eventTitle}</strong>{task.isSimulation ? <span className="map-popup-badge simulation-token">SIMULASI</span> : null}</div>
						<p className="mt-1 text-sm text-stone-600">{task.organizationName} • {task.venueName || "Lokasi belum ditentukan"} • {formatWitaRange(task.startsAt, task.endsAt)}</p>
						<div className="mt-2 flex flex-wrap gap-2 text-sm font-semibold">
							{task.canUpdateTraffic ? <span className="rounded border border-blue-200 bg-white px-2.5 py-1 text-blue-900">Pos Pecalang (Jalan)</span> : null}
							{task.canUpdateCleanup ? <span className="rounded border border-green-200 bg-white px-2.5 py-1 text-green-900">Tim Kebersihan</span> : null}
							{task.isOrganizerOversight ? <span className="rounded border border-purple-200 bg-white px-2.5 py-1 text-purple-900">Prajuru Desa</span> : null}
						</div>
					</div>
					<Link className="ui-button ui-button-primary field-task-action" to={`/field/events/${task.eventId}`}>Buka tugas</Link>
				</li>)}
			</ul>}
	</section>;
}
