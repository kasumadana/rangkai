import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { fetchEventsList } from "../lib/events-api";
import { formatWitaDateTime } from "../lib/wita";

export function OrganizerOverviewPage() {
 const events = useQuery({ queryKey: ["events", "overview"], queryFn: async () => { const first = await fetchEventsList({ page: 1, limit: 50 }); const all = [...first.events]; for (let page = 2; page <= first.pagination.totalPages; page++) { const next = await fetchEventsList({ page, limit: 50 }); all.push(...next.events); } return { ...first, events: all, loadedAt: Date.now() }; }, retry: false });
 const all = events.data?.events || [];
 const order = (a: { startsAt: string }, b: { startsAt: string }) => { const aTime = Date.parse(a.startsAt); const bTime = Date.parse(b.startsAt); return (Number.isFinite(aTime) ? aTime : Infinity) - (Number.isFinite(bTime) ? bTime : Infinity); };
 const attention = all.filter(event => event.status === "draft" || event.status === "review").sort(order).slice(0, 5);
 const now = events.data?.loadedAt || 0;
 const upcoming = all.filter(event => { const end = Date.parse(event.endsAt || event.startsAt); return (event.status === "published" || event.status === "active") && (!Number.isFinite(end) || end >= now); }).sort(order).slice(0, 5);
 return <div className="workspace-page overview-page"><header><h1>Ringkasan</h1><p>Hal yang perlu ditindaklanjuti dan kegiatan terdekat.</p><Link className="ui-button ui-button-primary" to="/dashboard/events/new">Buat kegiatan</Link></header>
 {events.isLoading ? <p role="status">Memuat kegiatan...</p> : events.isError ? <div role="alert"><p>Gagal memuat kegiatan.</p><button className="ui-button" type="button" onClick={() => void events.refetch()}>Coba lagi</button></div> : <>
  <section><h2>Perlu ditindaklanjuti</h2>{attention.length ? <ul className="overview-list">{attention.map(event => <li key={event.id}><Link to={`/dashboard/events/${event.id}`}>{event.title}</Link><p>{event.status === "draft" ? "Draf - lengkapi rincian" : "Dalam tinjauan - periksa data"}{event.isSimulation !== false && " - Simulasi"}</p><p>{event.startsAt && Number.isFinite(Date.parse(event.startsAt)) ? formatWitaDateTime(event.startsAt) : "Jadwal belum ditetapkan"}</p></li>)}</ul> : <p>Tidak ada draf atau tinjauan yang menunggu.</p>}</section>
  <section><h2>Kegiatan terdekat</h2>{upcoming.length ? <ul className="overview-list">{upcoming.map(event => <li key={event.id}><Link to={`/dashboard/events/${event.id}`}>{event.title}</Link><p>{event.startsAt && Number.isFinite(Date.parse(event.startsAt)) ? formatWitaDateTime(event.startsAt) : "Jadwal belum ditetapkan"}{event.isSimulation !== false && " - Simulasi"}</p></li>)}</ul> : <p>Belum ada kegiatan mendatang yang diumumkan.</p>}</section>
 </>}
 <Link to="/dashboard/events">Lihat semua kegiatan</Link></div>;
}
