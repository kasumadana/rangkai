import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { useMyOrganizationsQuery } from "../lib/auth";
import {
	fetchCleanupTasks,
	fetchEventAssignments,
	fetchEventsList,
	getSavedOrganizationId,
} from "../lib/events-api";
import { formatWitaDateTime } from "../lib/wita";

export function OrganizerOverviewPage() {
	const organizations = useMyOrganizationsQuery();
	const orgs = organizations.data?.organizations ?? [];
	const activeOrg =
		orgs.find((org) => org.id === getSavedOrganizationId()) ??
		orgs.find((org) => org.role === "organizer") ??
		orgs[0];
	const canManageOverview = activeOrg?.role === "organizer";
	const events = useQuery({
		queryKey: ["events", "overview", activeOrg?.id],
		queryFn: async () => {
			const first = await fetchEventsList({ page: 1, limit: 50, organizationId: activeOrg?.id });
			const all = [...first.events];
			for (let page = 2; page <= first.pagination.totalPages; page++) {
				const next = await fetchEventsList({ page, limit: 50, organizationId: activeOrg?.id });
				all.push(...next.events);
			}
			return { ...first, events: all, loadedAt: Date.now() };
		},
		enabled: organizations.isFetched,
		retry: false,
	});
	const all = events.data?.events || [];
	const order = (a: { startsAt: string }, b: { startsAt: string }) => {
		const aTime = Date.parse(a.startsAt);
		const bTime = Date.parse(b.startsAt);
		return (
			(Number.isFinite(aTime) ? aTime : Infinity) -
			(Number.isFinite(bTime) ? bTime : Infinity)
		);
	};
	const attention = all
		.filter((event) => event.status === "draft" || event.status === "review")
		.sort(order)
		.slice(0, 5);
	const now = events.data?.loadedAt || 0;
	const upcoming = all
		.filter((event) => {
			const end = Date.parse(event.endsAt || event.startsAt);
			return (
				(event.status === "published" || event.status === "active") &&
				(!Number.isFinite(end) || end >= now)
			);
		})
		.sort(order)
		.slice(0, 5);
	const cleanupEvents = all
		.filter((event) => {
			if (event.status === "completed") return true;
			if (event.status !== "published" && event.status !== "active") return false;
			const end = Date.parse(event.endsAt || event.startsAt);
			return Number.isFinite(end) && end < now;
		})
		.sort((a, b) => {
			const aEnd = Date.parse(a.endsAt || a.startsAt);
			const bEnd = Date.parse(b.endsAt || b.startsAt);
			return (Number.isFinite(bEnd) ? bEnd : 0) - (Number.isFinite(aEnd) ? aEnd : 0);
		})
		.slice(0, 5);
	const assignedOfficers = useQuery({
		queryKey: ["events", "overview", "assignments", upcoming.map((event) => event.id)],
		queryFn: async () => {
			const results = await Promise.all(
				upcoming.map(async (event) => ({
					event,
					assignments: (await fetchEventAssignments(event.id)).assignments,
				})),
			);
			return results.filter((result) => result.assignments.length > 0);
		},
		enabled: canManageOverview && events.isSuccess && upcoming.length > 0,
		retry: false,
	});
	const cleanupTasks = useQuery({
		queryKey: ["events", "overview", "cleanup-tasks", cleanupEvents.map((event) => event.id)],
		queryFn: async () => {
			const results = await Promise.all(
				cleanupEvents.map(async (event) => ({
					event,
					tasks: (await fetchCleanupTasks(event.id)).cleanupTasks,
				})),
			);
			return results.flatMap(({ event, tasks }) =>
				tasks
					.filter((task) => task.status === "submitted")
					.map((task) => ({ event, task })),
			);
		},
		enabled: canManageOverview && events.isSuccess && cleanupEvents.length > 0,
		retry: false,
	});

	return (
		<div className="workspace-page overview-page">
			<header>
				<div>
					<h1>Ringkasan</h1>
					<p>Hal yang perlu ditindaklanjuti dan kegiatan terdekat.</p>
				</div>
				<Link className="ui-button ui-button-primary" to="/dashboard/events/new">
					Buat kegiatan
				</Link>
			</header>

			{events.isPending ? (
				<p role="status">Memuat kegiatan...</p>
			) : events.isError ? (
				<div role="alert">
					<p>Gagal memuat kegiatan.</p>
					<button
						className="ui-button"
						type="button"
						onClick={() => void events.refetch()}
					>
						Coba lagi
					</button>
				</div>
			) : (
				<>
					<section aria-labelledby="overview-attention-heading">
						<div className="overview-section-heading">
							<h2 id="overview-attention-heading">Perlu ditindaklanjuti</h2>
						</div>
						{attention.length ? (
							<ul className="overview-list">
								{attention.map((event) => (
									<li className="overview-event-card" key={event.id}>
										<div className="overview-event-main">
											<h3>{event.title}</h3>
											<p>
												{event.status === "draft"
													? "Draf - lengkapi rincian"
													: "Dalam tinjauan - periksa data"}
												{event.isSimulation !== false ? " - Simulasi" : ""}
											</p>
											<p>
												{event.startsAt &&
												Number.isFinite(Date.parse(event.startsAt))
													? formatWitaDateTime(event.startsAt)
													: "Jadwal belum ditetapkan"}
											</p>
										</div>
										<Link
											className="ui-button ui-button-primary overview-event-action"
											to={
												event.status === "review"
													? `/dashboard/events/${event.id}/review`
													: `/dashboard/events/${event.id}`
											}
										>
											{event.status === "review" ? "Tinjau kegiatan" : "Lanjutkan draf"}
										</Link>
									</li>
								))}
							</ul>
						) : (
							<p>Tidak ada draf atau tinjauan yang menunggu.</p>
						)}
					</section>

					<section aria-labelledby="overview-upcoming-heading">
						<div className="overview-section-heading">
							<h2 id="overview-upcoming-heading">Kegiatan terdekat</h2>
							<Link className="ui-button" to="/dashboard/events">
								Lihat semua kegiatan
							</Link>
						</div>
						{upcoming.length ? (
							<ul className="overview-list">
								{upcoming.map((event) => (
									<li className="overview-event-card" key={event.id}>
										<div className="overview-event-main">
											<h3>{event.title}</h3>
											<p>
												{event.startsAt &&
												Number.isFinite(Date.parse(event.startsAt))
													? formatWitaDateTime(event.startsAt)
													: "Jadwal belum ditetapkan"}
												{event.isSimulation !== false ? " - Simulasi" : ""}
											</p>
										</div>
										<Link
											className="ui-button overview-event-action"
											to={`/dashboard/events/${event.id}`}
										>
											Kelola kegiatan
										</Link>
									</li>
								))}
							</ul>
						) : (
							<p>Belum ada kegiatan mendatang yang diumumkan.</p>
						)}
					</section>

					{canManageOverview ? <div className="overview-signals-grid">
						<section aria-labelledby="overview-officers-heading">
							<div className="overview-section-heading">
								<h2 id="overview-officers-heading">Petugas kegiatan terdekat</h2>
							</div>
							{upcoming.length === 0 ? (
								<p>Belum ada kegiatan terdekat.</p>
							) : assignedOfficers.isLoading ? (
								<p role="status">Memuat penugasan petugas...</p>
							) : assignedOfficers.isError ? (
								<div role="alert" className="overview-feedback">
									<p>Penugasan petugas belum dapat dimuat.</p>
									<button className="ui-button" type="button" onClick={() => void assignedOfficers.refetch()}>
										Coba lagi
									</button>
								</div>
							) : assignedOfficers.data?.length ? (
								<ul className="overview-list">
									{assignedOfficers.data.map(({ event, assignments }) => {
										const roles = [
											...(assignments.some((assignment) => assignment.canUpdateTraffic) ? ["Lalu lintas"] : []),
											...(assignments.some((assignment) => assignment.canUpdateCleanup) ? ["Kebersihan"] : []),
										];
										return (
											<li className="overview-event-card" key={event.id}>
												<div className="overview-event-main">
													<h3>{event.title}</h3>
													<p>{assignments.map((assignment) => assignment.userName || "Petugas lapangan").join(", ")}</p>
													<p>{roles.join(" · ")}{event.isSimulation !== false ? " · Simulasi" : ""}</p>
												</div>
												<Link className="ui-button overview-event-action" to={`/dashboard/events/${event.id}/team`}>
													Kelola petugas
												</Link>
											</li>
										);
									})}
								</ul>
							) : (
								<p>Belum ada petugas pada kegiatan terdekat.</p>
							)}
						</section>

						<section aria-labelledby="overview-cleanup-heading">
							<div className="overview-section-heading">
								<h2 id="overview-cleanup-heading">Kebersihan menunggu verifikasi</h2>
							</div>
							{cleanupEvents.length === 0 ? (
								<p>Belum ada kegiatan yang memerlukan pemeriksaan kebersihan.</p>
							) : cleanupTasks.isLoading ? (
								<p role="status">Memuat tugas kebersihan...</p>
							) : cleanupTasks.isError ? (
								<div role="alert" className="overview-feedback">
									<p>Tugas kebersihan belum dapat dimuat.</p>
									<button className="ui-button" type="button" onClick={() => void cleanupTasks.refetch()}>
										Coba lagi
									</button>
								</div>
							) : cleanupTasks.data?.length ? (
								<ul className="overview-list">
									{cleanupTasks.data.slice(0, 5).map(({ event, task }) => (
										<li className="overview-event-card" key={task.id}>
											<div className="overview-event-main">
												<h3>{task.title}</h3>
												<p>{event.title}{event.isSimulation !== false ? " · Simulasi" : ""}</p>
												<p>Menunggu verifikasi Prajuru</p>
											</div>
											<Link className="ui-button ui-button-primary overview-event-action" to={`/dashboard/events/${event.id}/cleanup`}>
													Tinjau tugas
												</Link>
											</li>
									))}
								</ul>
							) : (
								<p>Tidak ada tugas kebersihan yang menunggu verifikasi.</p>
							)}
						</section>
					</div> : null}
				</>
			)}
		</div>
	);
}
