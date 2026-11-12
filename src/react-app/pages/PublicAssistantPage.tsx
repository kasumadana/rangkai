import { useEffect, useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router";
import { ApiClientError } from "../lib/api-client";
import { formatWitaEventSchedule } from "../lib/events-api";
import { askPublicAssistant } from "../lib/public-assistant-api";

const roadLabels: Record<string, string> = { open: "Terbuka", closed: "Ditutup", intermittent: "Buka tutup", unknown: "Belum terkonfirmasi", unconfirmed: "Belum terkonfirmasi" };
const eventLabels: Record<string, string> = { published: "Terjadwal", active: "Berlangsung", completed: "Selesai" };

export function PublicAssistantPage() {
 const [params] = useSearchParams();
 const [now, setNow] = useState(() => Date.now());
 useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(timer); }, []);
 const [question, setQuestion] = useState("");
 const [location, setLocation] = useState("");
 const [eventSlug, setEventSlug] = useState(params.get("event") ?? "");
 const [validation, setValidation] = useState("");
 const mutation = useMutation({ mutationFn: askPublicAssistant, retry: false });
 function submit(event: FormEvent) {
  event.preventDefault();
  const q = question.trim(); const slug = eventSlug.trim(); const place = location.trim();
  if (!q || q.length > 500 || (slug && !/^[a-z0-9-]{1,120}$/.test(slug)) || place.length > 100) {
   setValidation("Isi pertanyaan hingga 500 karakter. Kode kegiatan hanya boleh berisi huruf kecil, angka, dan tanda hubung; lokasi maksimal 100 karakter."); return;
  }
  setValidation(""); mutation.mutate({ question: q, ...(slug && { eventSlug: slug }), ...(place && { location: place }) });
 }
 return <main className="teduh-page-shell assistant-panel"><section className="teduh-page-container max-w-3xl">
  <div className="flex flex-col gap-6">
   <header><h1 className="teduh-page-title">Tanya tentang kegiatan</h1><p>Temukan informasi kegiatan, kondisi jalan, atau ringkasan kebersihan yang sudah dipublikasikan.</p></header>
   <form onSubmit={submit}><div className="flex flex-col gap-4">
    <p>Pertanyaan diproses oleh Gemini dari Google, penyedia AI eksternal. Jangan sertakan data pribadi atau informasi rahasia.</p>
    <label className="flex flex-col gap-2">Pertanyaan<textarea className="teduh-form-input" value={question} onChange={event => setQuestion(event.target.value)} maxLength={500} placeholder="Contoh: Kapan kegiatan berlangsung?" /></label>
    <label className="flex flex-col gap-2">Lokasi (opsional)<input className="teduh-form-input" value={location} onChange={event => setLocation(event.target.value)} placeholder="Nama tempat, desa, atau kecamatan" /></label>
    <label className="flex flex-col gap-2">Kode kegiatan (opsional)<input className="teduh-form-input" value={eventSlug} onChange={event => setEventSlug(event.target.value)} aria-describedby="event-slug-description" /><small id="event-slug-description">Bagian terakhir tautan kegiatan, jika diketahui.</small></label>
    {validation && <p role="alert">{validation}</p>}
    <button className="teduh-btn-primary" type="submit" disabled={mutation.isPending} aria-busy={mutation.isPending}>{mutation.isPending ? "Mencari jawaban" : "Kirim pertanyaan"}</button>
   </div></form>
   {mutation.isError && <section role="alert"><h2>Jawaban belum tersedia</h2><p>{mutation.error instanceof ApiClientError && mutation.error.status === 503 ? "Layanan tanya jawab sedang tidak tersedia. Silakan coba lagi atau cari kegiatan." : mutation.error instanceof ApiClientError && mutation.error.status === 429 ? "Terlalu banyak permintaan. Tunggu sebentar lalu coba lagi." : "Pertanyaan belum dapat diproses. Periksa isian dan koneksi, lalu coba lagi."}</p><button className="teduh-btn-secondary" type="button" disabled={mutation.isPending} onClick={() => mutation.mutate(mutation.variables!)}>Coba lagi</button> <Link to="/events">Cari kegiatan</Link></section>}
   {mutation.data && <section aria-live="polite"><h2>{mutation.data.status === "abstained" ? "Belum dapat menjawab" : "Hasil"}</h2><p>{mutation.data.answer}</p>
    {mutation.data.sources.length > 0 && <><h3>Sumber</h3><ul>{mutation.data.sources.map(source => <li key={source.sourceId} className="py-4 break-words"><Link to={source.publicUrl}>{source.title}</Link><p>{source.isSimulation ? "Simulasi · " : ""}{source.sourceId.startsWith("road:") ? `Status jalan: ${!source.expiresAt || !Number.isFinite(Date.parse(source.expiresAt)) || Date.parse(source.expiresAt) <= now ? "belum terkonfirmasi" : (roadLabels[source.status.toLowerCase()] ?? "Belum terkonfirmasi")}` : `Status kegiatan: ${eventLabels[source.status] ?? source.status}`}</p>{"startsAt" in source && <p>Jadwal: {source.startsAt ? `${formatWitaEventSchedule(source.startsAt, source.endsAt).dateLabel}, ${source.endsAt ? formatWitaEventSchedule(source.startsAt, source.endsAt).windowWita : `${formatWitaEventSchedule(source.startsAt, null).windowWita.split(" WITA")[0]} WITA; waktu selesai belum diketahui`}` : "belum diketahui"}</p>}{source.observedAt && <p>Diamati: {new Date(source.observedAt).toLocaleString("id-ID", { timeZone: "Asia/Makassar" })} WITA</p>}{"summary" in source && <p>Tugas diverifikasi: {source.summary.verifiedTasks} dari {source.summary.totalTasks}</p>}</li>)}</ul></>}
    <Link to="/events">Cari kegiatan lainnya</Link></section>}
  </div>
 </section></main>;
}
