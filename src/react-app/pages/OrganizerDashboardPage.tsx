import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { useAuthSession, useMyOrganizationsQuery } from "../lib/auth";
import { fetchEventsList, saveOrganizationId } from "../lib/events-api";
import type { EventLifecycleStatus } from "../lib/api-client";
import { formatWitaDateTime, formatWitaRange } from "../lib/wita";

const statuses: { value: EventLifecycleStatus | "all"; label: string }[] = [
 { value: "all", label: "Semua" }, { value: "draft", label: "Draf" },
 { value: "review", label: "Dalam tinjauan" }, { value: "published", label: "Diumumkan" },
 { value: "active", label: "Aktif" }, { value: "completed", label: "Selesai" },
 { value: "cancelled", label: "Dibatalkan" }, { value: "archived", label: "Diarsipkan" },
];
const statusLabel = (status: EventLifecycleStatus) => statuses.find(item => item.value === status)?.label || status;

export function OrganizerDashboardPage() {
 const [status, setStatus] = useState<EventLifecycleStatus | "all">("all");
 const [orgId, setOrgId] = useState("all");
 const [search, setSearch] = useState("");
 const { data: session } = useAuthSession();
 const organizations = useMyOrganizationsQuery();
 const orgs = organizations.data?.organizations || [];
 const events = useQuery({ queryKey: ["events", { status, organizationId: orgId }], queryFn: async () => { const params = { limit: 50, status: status === "all" ? undefined : status, organizationId: orgId === "all" ? undefined : orgId }; const first = await fetchEventsList({ ...params, page: 1 }); const all = [...first.events]; for (let page = 2; page <= first.pagination.totalPages; page++) { const next = await fetchEventsList({ ...params, page }); all.push(...next.events); } return { ...first, events: all }; }, retry: false });
 const rows = useMemo(() => (events.data?.events || []).filter(event => [event.title, event.venueName, event.permitReference].some(value => value?.toLowerCase().includes(search.trim().toLowerCase()))), [events.data, search]);
 return <div className="workspace-page">
  <header className="workspace-page-header"><div><h1>Kegiatan</h1><p>Cari dan kelola kegiatan organisasi Anda.</p></div><Link className="ui-button ui-button-primary" to="/dashboard/events/new">Buat kegiatan</Link></header>
  {session?.user && organizations.isSuccess && !orgs.length && <section className="ui-notice"><h2>Belum terhubung ke organisasi</h2><p>Daftarkan organisasi untuk membuat kegiatan.</p><Link to="/onboarding/organization">Daftarkan organisasi</Link></section>}
  <section aria-label="Filter kegiatan" className="event-filters">
   <label>Cari kegiatan<input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Nama, lokasi, atau nomor surat" /></label>
   <label>Status<select value={status} onChange={e => setStatus(e.target.value as EventLifecycleStatus | "all")}>{statuses.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
   {orgs.length > 0 && <label>Organisasi<select value={orgId} onChange={e => { const value = e.target.value; setOrgId(value); if (orgs.some(org => org.id === value)) saveOrganizationId(value); }}><option value="all">Semua organisasi saya</option>{orgs.map(org => <option key={org.id} value={org.id}>{org.name}</option>)}</select></label>}
  </section>
  {events.isLoading ? <p role="status">Memuat kegiatan...</p> : events.isError ? <div role="alert"><p>Gagal memuat kegiatan.</p><button className="ui-button" type="button" onClick={() => void events.refetch()}>Coba lagi</button></div> : !rows.length ? <section><h2>Belum ada kegiatan yang cocok</h2><p>Ubah filter atau buat kegiatan baru.</p><button className="ui-button" type="button" onClick={() => { setSearch(""); setStatus("all"); setOrgId("all"); }}>Reset filter</button></section> : <div className="event-list" data-testid="events-list">{rows.map(event => <article className="event-row" data-testid="event-row" data-event-id={event.id} key={event.id}>
   <div><h2><Link to={`/dashboard/events/${event.id}`}>{event.title}</Link></h2><p>{statusLabel(event.status)}{event.isSimulation !== false && " - Simulasi"}</p><p>{orgs.find(org => org.id === event.organizationId)?.name || "Organisasi penyelenggara"}</p><p>{event.venueName || "Lokasi belum diisi"}</p><p>{event.startsAt && event.endsAt ? formatWitaRange(event.startsAt, event.endsAt) : event.startsAt ? formatWitaDateTime(event.startsAt) : "Jadwal belum ditetapkan"}</p>{event.permitReference && <p>Referensi izin: {event.permitReference}</p>}</div>
   <div className="event-row-actions"><Link className="ui-button" to={`/dashboard/events/${event.id}`}>Kelola kegiatan</Link>{event.publicSlug && (event.status === "published" || event.status === "active") && <Link to={`/events/${event.publicSlug}`}>Lihat publik</Link>}</div>
  </article>)}</div>}
 </div>;
}
