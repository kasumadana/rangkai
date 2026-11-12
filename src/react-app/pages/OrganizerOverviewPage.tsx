import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { fetchEventsList } from "../lib/events-api";
import { formatWitaDateTime } from "../lib/wita";

export function OrganizerOverviewPage() {
 const events = useQuery({ queryKey: ["events", "overview"], queryFn: () => fetchEventsList({ page: 1, limit: 50 }), retry: false });
 const attention = (events.data?.events || []).filter(event => event.status === "draft" || event.status === "review").slice(0, 5);
 const upcoming = (events.data?.events || []).filter(event => event.status === "published" || event.status === "active").slice(0, 5);
 return <div className="overview-page"><header><h1>Ringkasan</h1><p>Hal yang perlu ditindaklanjuti dan kegiatan yang telah diumumkan.</p><Link className="simple-button" to="/dashboard/events/new">Buat kegiatan</Link></header>
 {events.isLoading ? <p>Memuat kegiatan...</p> : events.isError ? <div role="alert"><p>Gagal memuat kegiatan.</p><button type="button" onClick={() => void events.refetch()}>Coba lagi</button></div> : <><section><h2>Perlu ditindaklanjuti</h2>{attention.length ? <ul>{attention.map(event => <li key={event.id}><Link to={`/dashboard/events/${event.id}`}>{event.title}</Link> Â· {event.status === "draft" ? "Draf" : "Dalam tinjauan"}{event.isSimulation !== false && " Â· Simulasi"}</li>)}</ul> : <p>Tidak ada draf atau tinjauan yang menunggu.</p>}</section><section><h2>Kegiatan diumumkan</h2>{upcoming.length ? <ul>{upcoming.map(event => <li key={event.id}><Link to={`/dashboard/events/${event.id}`}>{event.title}</Link> Â· {event.startsAt ? formatWitaDateTime(event.startsAt) : "Jadwal belum ditetapkan"}{event.isSimulation !== false && " Â· Simulasi"}</li>)}</ul> : <p>Belum ada kegiatan yang diumumkan.</p>}</section></>}
 <Link to="/dashboard/events">Lihat semua kegiatan</Link></div>;
}

