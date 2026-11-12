import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation } from "react-router";
import { useAuthSession, useMyOrganizationsQuery } from "../../lib/auth";
import { ApiClientError } from "../../lib/api-client";
import { askPublicAssistant } from "../../lib/public-assistant-api";
import { askInternal, type InternalResponse } from "./client";
import "./widget.css";
type PublicResponse = Awaited<ReturnType<typeof askPublicAssistant>>;
type Entry = { question: string; response: PublicResponse | InternalResponse };
type Mode = "public" | "internal" | "help";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const date = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value)) ? `${new Date(value).toLocaleString("id-ID", { timeZone: "Asia/Makassar" })} WITA` : "belum diketahui";
function errorText(error: unknown) {
 if (error instanceof ApiClientError) {
  if (error.status === 401) return "Sesi berakhir. Masuk kembali untuk menggunakan konteks internal.";
  if (error.status === 403 || error.status === 404) return "Konteks tidak ditemukan atau Anda tidak memiliki akses. Pilih konteks lain.";
  if (error.status === 429) return "Terlalu banyak permintaan. Tunggu sebentar lalu coba lagi.";
  if (error.status === 503) return "Layanan asisten belum tersedia. Coba lagi atau gunakan halaman kegiatan.";
 }
 return "Jawaban tidak dapat diproses atau respons tidak valid. Periksa koneksi dan coba lagi.";
}
export function AssistantWidget() {
 const location = useLocation(); const session = useAuthSession(); const orgs = useMyOrganizationsQuery();
 const identity = !session.isError && session.data?.user.id || "";
 const [open, setOpen] = useState(false); const [mode, setMode] = useState<Mode>("public");
 const [org, setOrg] = useState(""); const [eventId, setEventId] = useState(""); const [slug, setSlug] = useState("");
 const [topic, setTopic] = useState<"event" | "traffic" | "cleanup">("event");
 const [draft, setDraft] = useState(""); const [entries, setEntries] = useState<Record<string, Entry[]>>({});
 const [error, setError] = useState(""); const [pending, setPending] = useState(false);
 const controller = useRef<AbortController | null>(null); const generation = useRef(0); const trigger = useRef<HTMLButtonElement>(null); const dialog = useRef<HTMLDivElement>(null);
 const scope = mode === "public" ? "public" : mode === "help" ? `help:${identity}` : `internal:${identity}:${org}:${eventId}`;
 const validOrg = !!identity && !session.isFetching && !orgs.isError && !orgs.isFetching && !!orgs.data?.organizations.some(item => item.id === org);
 const invalidate = () => { generation.current++; controller.current?.abort(); controller.current = null; setPending(false); setError(""); };
 useEffect(() => { const handler = (e: Event) => { const value = (e as CustomEvent<string>).detail; if (value) setSlug(value); setOpen(true); }; window.addEventListener("rangkai:assistant-open", handler); return () => window.removeEventListener("rangkai:assistant-open", handler); }, []);
 useEffect(() => { if (location.pathname === "/tanya") { setSlug(new URLSearchParams(location.search).get("event") ?? ""); setOpen(true); } }, [location.pathname, location.search]);
 useEffect(() => { const clear = () => { invalidate(); setEntries(previous => Object.fromEntries(Object.entries(previous).filter(([key]) => key === "public"))); setOrg(""); setEventId(""); setMode("public"); setDraft(""); }; window.addEventListener("rangkai:session-changed", clear); window.addEventListener("rangkai:organization-changed", clear); return () => { window.removeEventListener("rangkai:session-changed", clear); window.removeEventListener("rangkai:organization-changed", clear); }; }, []);
 const previousIdentity = useRef(identity);
 useEffect(() => { if (previousIdentity.current !== identity || session.isError) { previousIdentity.current = identity; invalidate(); setEntries(previous => Object.fromEntries(Object.entries(previous).filter(([key]) => key === "public"))); setOrg(""); setEventId(""); setMode("public"); setDraft(""); } }, [identity, session.isError]);
 useEffect(() => { if (!open) return; const root = document.getElementById("root"); if (root) root.inert = true; dialog.current?.focus(); const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); setOpen(false); trigger.current?.focus(); } if (event.key === "Tab" && dialog.current) { const items = Array.from(dialog.current.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled)')); const first = items[0]; const last = items[items.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } } }; document.addEventListener("keydown", onKey); return () => { document.removeEventListener("keydown", onKey); if (root) root.inert = false; }; }, [open]);
 function close() { setOpen(false); trigger.current?.focus(); }
 function changeMode(next: Mode) { invalidate(); setMode(next); setDraft(""); }
 async function submit(e: FormEvent) { e.preventDefault(); const question = draft.trim(); if (!question || question.length > 500) { setError("Isi pertanyaan hingga 500 karakter."); return; } if (mode === "internal" && (!validOrg || !uuid.test(eventId))) { setError("Pilih organisasi dan masukkan ID kegiatan yang dapat Anda akses."); return; } if (mode !== "public" && !identity) { setError("Masuk kembali untuk menggunakan konteks ini."); return; }
  invalidate(); const serial = generation.current; const abort = new AbortController(); controller.current = abort; setPending(true);
  try { const response = mode === "public" ? await askPublicAssistant({ question, ...(slug && { eventSlug: slug }) }, abort.signal) : await askInternal({ question, ...(mode === "help" ? { helpTopic: topic } : { organizationId: org, eventId }) }, abort.signal); if (serial !== generation.current || abort.signal.aborted) return; setEntries(previous => ({ ...previous, [scope]: [...(previous[scope] ?? []), { question, response }] })); setDraft(""); }
  catch (err) { if (serial === generation.current && !abort.signal.aborted) { setError(errorText(err)); if (err instanceof ApiClientError && [401, 403, 404].includes(err.status) && mode !== "public") setEntries(previous => ({ ...previous, [scope]: [] })); } }
  finally { if (serial === generation.current) setPending(false); }
 }
 const visible = mode === "public" || (identity && (mode === "help" || validOrg)) ? entries[scope] ?? [] : [];
 return createPortal(<><button ref={trigger} type="button" className="assistant-trigger" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open}>Asisten</button>{open && <div className="assistant-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) close(); }}><div ref={dialog} className="assistant-widget" role="dialog" aria-modal="true" aria-labelledby="assistant-title" tabIndex={-1}><header><h2 id="assistant-title">Asisten</h2><button type="button" onClick={close} aria-label="Tutup asisten">Tutup</button></header><div className="assistant-content"><p>Informasi hanya baca. Untuk perubahan, buka halaman kegiatan dan lakukan langkahnya sendiri.</p><label>Lingkup<select value={mode} onChange={e => changeMode(e.target.value as Mode)}><option value="public">Informasi publik</option>{identity && <><option value="internal">Data internal</option><option value="help">Panduan penggunaan</option></>}</select></label>
 {mode === "internal" && <><label>Organisasi<select value={org} onChange={e => { invalidate(); setOrg(e.target.value); setEventId(""); }}><option value="">Pilih organisasi</option>{!orgs.isError && orgs.data?.organizations.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>{orgs.isError && <p role="alert">Daftar organisasi belum tersedia. Coba muat ulang halaman.</p>}<label>ID kegiatan<input value={eventId} onChange={e => { invalidate(); setEventId(e.target.value); }} placeholder="ID kegiatan" /></label><Link to="/dashboard/events" onClick={close}>Buka kegiatan</Link></>}
 {mode === "public" && <label>Kode kegiatan (opsional)<input value={slug} onChange={e => setSlug(e.target.value)} /></label>}{mode === "help" && <label>Topik panduan<select value={topic} onChange={e => setTopic(e.target.value as typeof topic)}><option value="event">Kegiatan</option><option value="traffic">Jalan</option><option value="cleanup">Kebersihan</option></select></label>}
 <p>Pertanyaan berbasis data diproses oleh Gemini dari Google, penyedia eksternal. Jangan kirim data pribadi, dokumen, atau informasi rahasia. Panduan penggunaan telah ditinjau.</p>
 {visible.map((entry, index) => <section key={index} className="assistant-answer"><p><strong>Anda:</strong> {entry.question}</p><p><strong>{"scope" in entry.response && entry.response.scope === "help" ? "Panduan penggunaan" : mode === "public" ? "Informasi publik" : "Data internal"}:</strong> {entry.response.answer}</p>{entry.response.sources.map(source => <article key={source.sourceId}><Link to={"url" in source ? source.url : source.publicUrl} onClick={close}>{source.title}</Link>{"facts" in source ? <><p>{source.facts.isSimulation ? "Simulasi · " : ""}{source.kind === "road" && (!source.facts.expiresAt || Date.parse(String(source.facts.expiresAt)) <= Date.now()) ? "Belum terkonfirmasi" : ("status" in source.facts ? source.facts.status : "")}</p>{source.kind === "event" && <p>Mulai: {date(source.facts.startsAt)}; selesai: {date(source.facts.endsAt)}</p>}{source.kind === "road" && <p>Diamati: {date(source.facts.observedAt)}; berlaku sampai: {date(source.facts.expiresAt)}</p>}{source.kind === "cleanup" && <p>Tenggat: {date(source.facts.dueAt)}</p>}{source.kind === "waste" && <p>{String(source.facts.category)} · {String(source.facts.measurementMethod)} · {String(source.facts.quantityKg ?? "—")} kg · {String(source.facts.sackCount ?? "—")} karung</p>}</> : <><p>{source.isSimulation ? "Simulasi · " : ""}{source.sourceId.startsWith("road:") && (!source.expiresAt || Date.parse(source.expiresAt) <= Date.now()) ? "Belum terkonfirmasi" : source.status}</p>{source.observedAt && <p>Diamati: {date(source.observedAt)}; berlaku sampai: {date(source.expiresAt)}</p>}{"startsAt" in source && <p>Mulai: {date(source.startsAt)}; selesai: {date(source.endsAt)}</p>}{"summary" in source && <p>Tugas diverifikasi: {source.summary.verifiedTasks} dari {source.summary.totalTasks}</p>}</>}</article>)}</section>)}
 <form onSubmit={submit}><label>Pertanyaan<textarea value={draft} onChange={e => setDraft(e.target.value)} maxLength={500} rows={3} /></label>{error && <p role="alert">{error}</p>}<button type="submit" className="teduh-btn-primary" disabled={pending}>{pending ? "Mencari jawaban…" : error ? "Coba lagi" : "Kirim pertanyaan"}</button></form><Link to="/events" onClick={close}>Cari kegiatan secara manual</Link></div></div></div>}</>, document.body);
}


