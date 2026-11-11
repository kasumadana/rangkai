import { useEffect, useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@astryxdesign/core/Button";
import { TextArea } from "@astryxdesign/core/TextArea";
import { TextInput } from "@astryxdesign/core/TextInput";
import { VStack } from "@astryxdesign/core/Stack";
import { Link, useSearchParams } from "react-router";
import { ApiClientError } from "../lib/api-client";
import { askPublicAssistant } from "../lib/public-assistant-api";

const statusLabels: Record<string, string> = { OPEN: "Terbuka", CLOSED: "Ditutup", INTERMITTENT: "Buka tutup", UNKNOWN: "Belum terkonfirmasi", published: "Terjadwal", active: "Berlangsung" };

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
 return <main className="teduh-page-shell"><section className="teduh-page-container max-w-3xl">
  <VStack gap={6}>
   <header><h1 className="teduh-page-title">Tanya tentang kegiatan</h1><p>Temukan informasi kegiatan, kondisi jalan, atau ringkasan kebersihan yang sudah dipublikasikan.</p></header>
   <form onSubmit={submit}><VStack gap={4}>
    <TextArea label="Pertanyaan" value={question} onChange={setQuestion} maxLength={500} placeholder="Contoh: Kapan kegiatan berlangsung?" width="100%" />
    <TextInput label="Lokasi (opsional)" value={location} onChange={setLocation} placeholder="Nama tempat, desa, atau kecamatan" width="100%" />
    <TextInput label="Kode kegiatan (opsional)" value={eventSlug} onChange={setEventSlug} description="Bagian terakhir tautan kegiatan, jika diketahui." width="100%" />
    {validation && <p role="alert">{validation}</p>}
    <Button label={mutation.isPending ? "Mencari jawaban" : "Kirim pertanyaan"} type="submit" variant="primary" isLoading={mutation.isPending} />
   </VStack></form>
   {mutation.isError && <section role="alert"><h2>Jawaban belum tersedia</h2><p>{mutation.error instanceof ApiClientError && mutation.error.status === 503 ? "Layanan tanya jawab sedang tidak tersedia. Silakan coba lagi atau cari kegiatan." : mutation.error instanceof ApiClientError && mutation.error.status === 429 ? "Terlalu banyak permintaan. Tunggu sebentar lalu coba lagi." : "Pertanyaan belum dapat diproses. Periksa isian dan koneksi, lalu coba lagi."}</p><Button label="Coba lagi" onClick={() => mutation.mutate(mutation.variables!)} /> <Link to="/events">Cari kegiatan</Link></section>}
   {mutation.data && <section aria-live="polite"><h2>{mutation.data.status === "abstained" ? "Belum dapat menjawab" : "Hasil"}</h2><p>{mutation.data.answer}</p>
    {mutation.data.sources.length > 0 && <><h3>Sumber</h3><ul>{mutation.data.sources.map(source => <li key={source.sourceId} className="py-4 break-words"><Link to={source.publicUrl}>{source.title}</Link><p>{source.isSimulation ? "Simulasi · " : ""}{source.sourceId.startsWith("road:") ? `Status jalan: ${!source.expiresAt || Date.parse(source.expiresAt) <= now ? "belum terkonfirmasi" : (statusLabels[source.status] ?? "Belum terkonfirmasi")}` : `Status kegiatan: ${statusLabels[source.status] ?? source.status}`}</p>{source.observedAt && <p>Diamati: {new Date(source.observedAt).toLocaleString("id-ID", { timeZone: "Asia/Makassar" })} WITA</p>}{"summary" in source && <p>Tugas diverifikasi: {source.summary.verifiedTasks} dari {source.summary.totalTasks}</p>}</li>)}</ul></>}
    <Link to="/events">Cari kegiatan lainnya</Link></section>}
  </VStack>
 </section></main>;
}
