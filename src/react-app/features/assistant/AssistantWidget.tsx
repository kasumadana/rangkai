import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	type FormEvent,
} from "react";
import { createPortal } from "react-dom";
import { Link, useLocation } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Send, X } from "lucide-react";
import { gsap } from "gsap";
import { api, ApiClientError } from "../../lib/api-client";
import { fetchFieldTasks, getSavedOrganizationId } from "../../lib/events-api";
import { useAuthSession, useMyOrganizationsQuery } from "../../lib/auth";
import { askPublicAssistant } from "../../lib/public-assistant-api";
import { askInternal, type InternalResponse } from "./client";
import "./widget.css";

type PublicResponse = Awaited<ReturnType<typeof askPublicAssistant>>;
type Entry = { question: string; response: PublicResponse | InternalResponse };
type Mode = "public" | "internal";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const prefersReducedMotion = () =>
	window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const statusLabel = (value: string) =>
	({
		open: "Terbuka",
		closed: "Ditutup",
		intermittent: "Buka-tutup",
		unknown: "Belum terkonfirmasi",
		unconfirmed: "Belum terkonfirmasi",
	})[value.toLowerCase()] ?? value;

const date = (value: unknown) =>
	typeof value === "string" && Number.isFinite(Date.parse(value))
		? `${new Date(value).toLocaleString("id-ID", { timeZone: "Asia/Makassar" })} WITA`
		: "belum diketahui";

function errorText(error: unknown) {
	if (error instanceof ApiClientError) {
		if (error.status === 401)
			return "Sesi berakhir. Masuk kembali untuk menggunakan konteks internal.";
		if (error.status === 403 || error.status === 404)
			return "Konteks tidak ditemukan atau Anda tidak memiliki akses. Pilih konteks lain.";
		if (error.status === 429)
			return "Terlalu banyak permintaan. Tunggu sebentar lalu coba lagi.";
		if (error.status === 503)
			return "Layanan asisten belum tersedia. Coba lagi nanti.";
	}
	return "Jawaban tidak dapat diproses atau respons tidak valid. Periksa koneksi dan coba lagi.";
}

export function AssistantWidget() {
	const location = useLocation();
	const queryClient = useQueryClient();
	const session = useAuthSession();
	const orgs = useMyOrganizationsQuery();
	const routeEventId =
		location.pathname.match(
			/^\/(?:dashboard|field)\/events\/([0-9a-f-]{36})(?:\/|$)/i,
		)?.[1] ?? "";
	const sessionExpiry = Date.parse(session.data?.session.expiresAt ?? "");
	const [clock, setClock] = useState(() => Date.now());
	const identity =
		(!session.isError &&
			Number.isFinite(sessionExpiry) &&
			sessionExpiry > clock &&
			session.data?.user.id) ||
		"";

	useEffect(() => {
		if (!Number.isFinite(sessionExpiry)) return;
		const delay = Math.max(0, Math.min(sessionExpiry - Date.now(), 2147483647));
		const timer = window.setTimeout(() => setClock(Date.now()), delay);
		return () => window.clearTimeout(timer);
	}, [sessionExpiry, clock]);

	const [open, setOpen] = useState(false);
	const [mode, setMode] = useState<Mode>("public");
	const [org, setOrg] = useState("");
	const [eventId, setEventId] = useState("");
	const [slug, setSlug] = useState("");
	const [drafts, setDrafts] = useState<Record<string, string>>({});
	const [entries, setEntries] = useState<Record<string, Entry[]>>({});
	const [error, setError] = useState("");
	const [pending, setPending] = useState(false);
	const [pendingQuestion, setPendingQuestion] = useState("");

	const controller = useRef<AbortController | null>(null);
	const generation = useRef(0);
	const closing = useRef(false);
	const previousVisibleLength = useRef(0);
	const previousScope = useRef("");
	const trigger = useRef<HTMLButtonElement>(null);
	const backdrop = useRef<HTMLDivElement>(null);
	const dialog = useRef<HTMLDivElement>(null);
	const content = useRef<HTMLDivElement>(null);
	const headerAccent = useRef<HTMLSpanElement>(null);

	const scope =
		mode === "public"
			? "public"
			: `internal:${identity}:${org}:${eventId}`;

	const membership = orgs.data?.organizations.find((item) => item.id === org);
	const savedOrganizationId = getSavedOrganizationId();
	const activeOrganization =
		orgs.data?.organizations.find((item) => item.id === savedOrganizationId) ??
		orgs.data?.organizations.find((item) => item.role === "organizer") ??
		orgs.data?.organizations[0];
	const activeOrganizationId = activeOrganization?.id;

	const events = useQuery({
		queryKey: ["assistant", "contexts", identity, org, membership?.role],
		enabled:
			mode === "internal" &&
			!!identity &&
			!!membership &&
			!session.isFetching &&
			!session.isError &&
			!orgs.isFetching &&
			!orgs.isError,
		retry: false,
		queryFn: async () => {
			if (membership?.role === "organizer") {
				const items: Array<{ id: string; title: string; organizationId: string }> = [];
				let page = 1;
				let totalPages = 1;
				do {
					const result = await api.listEvents({
						organizationId: org,
						limit: 100,
						page,
					});
					items.push(...result.events.map((event) => ({
						id: event.id,
						title: event.title,
						organizationId: event.organizationId,
					})));
					totalPages = Math.max(1, result.pagination.totalPages ?? 1);
					if (items.some((item) => item.id === routeEventId && item.organizationId === org)) break;
					page += 1;
				} while (page <= totalPages);
				return { items, totalPages };
			}
			return {
				items: (await fetchFieldTasks()).assignments
					.filter((item) => item.organizationId === org)
					.map((item) => ({
						id: item.eventId,
						title: item.eventTitle,
						organizationId: item.organizationId,
					})),
				totalPages: 1,
			};
		},
	});

	const choices =
		events.data?.items.filter((event) => event.organizationId === org) ?? [];
	const draft = drafts[scope] ?? "";
	const setDraft = (value: string) =>
		setDrafts((previous) => ({ ...previous, [scope]: value }));
	const validOrg =
		!!identity &&
		!session.isFetching &&
		!orgs.isError &&
		!orgs.isFetching &&
		!!orgs.data?.organizations.some((item) => item.id === org);
	const visible =
		mode === "public" ||
		(identity &&
			!session.isFetching &&
			!session.isError &&
			validOrg &&
			!events.isError &&
			!events.isFetching &&
			choices.some((item) => item.id === eventId))
			? (entries[scope] ?? [])
			: [];

	const invalidate = () => {
		generation.current++;
		controller.current?.abort();
		controller.current = null;
		setPending(false);
		setPendingQuestion("");
		setError("");
	};
	const close = useCallback(() => {
		if (!open || closing.current || prefersReducedMotion() || !dialog.current || !backdrop.current) {
			setOpen(false);
			trigger.current?.focus();
			return;
		}
		closing.current = true;
		gsap.timeline({
			defaults: { overwrite: "auto" },
			onComplete: () => {
				closing.current = false;
				setOpen(false);
				trigger.current?.focus();
			},
		})
			.to(dialog.current, {
				autoAlpha: 0,
				y: window.matchMedia("(max-width: 600px)").matches ? 12 : 8,
				duration: 0.15,
				ease: "power2.in",
			})
			.to(backdrop.current, { autoAlpha: 0, duration: 0.12, ease: "power1.in" }, "<");
	}, [open]);

	useEffect(() => {
		if (!identity || !activeOrganizationId) {
			setOrg("");
			return;
		}
		setOrg((current) =>
			current === activeOrganizationId ? current : activeOrganizationId,
		);
	}, [identity, activeOrganizationId]);

	useEffect(() => {
		if (routeEventId && identity && !session.isFetching && !session.isError) {
			setMode("internal");
			return;
		}
		setMode("public");
		setEventId("");
	}, [routeEventId, identity, session.isFetching, session.isError]);

	useEffect(() => {
		if (!routeEventId || mode !== "internal" || !org) return;
		if (!events.isSuccess && !events.isError) return;
		const canReadEvent =
			events.isSuccess &&
			events.data?.items.some(
				(item) => item.organizationId === org && item.id === routeEventId,
			);
		if (canReadEvent) {
			setEventId(routeEventId);
			return;
		}
		setMode("public");
		setEventId("");
	}, [routeEventId, mode, org, events.isSuccess, events.isError, events.data]);

	useEffect(() => {
		const handler = (e: Event) => {
			const value = (e as CustomEvent<string>).detail;
			if (value) setSlug(value);
			setOpen(true);
		};
		window.addEventListener("rangkai:assistant-open", handler);
		return () => window.removeEventListener("rangkai:assistant-open", handler);
	}, []);

	useEffect(() => {
		if (location.pathname === "/tanya") {
			setSlug(new URLSearchParams(location.search).get("event") ?? "");
			setOpen(true);
		}
	}, [location.pathname, location.search]);

	useEffect(() => {
		const clear = () => {
			invalidate();
			setEntries((previous) =>
				Object.fromEntries(
					Object.entries(previous).filter(([key]) => key === "public"),
				),
			);
			setOrg("");
			setEventId("");
			setMode(routeEventId && identity && !session.isError ? "internal" : "public");
			setDrafts((previous) => ({ public: previous.public ?? "" }));
			queryClient.removeQueries({ queryKey: ["assistant", "contexts"] });
		};
		window.addEventListener("rangkai:session-changed", clear);
		window.addEventListener("rangkai:organization-changed", clear);
		return () => {
			window.removeEventListener("rangkai:session-changed", clear);
			window.removeEventListener("rangkai:organization-changed", clear);
		};
	}, [queryClient, routeEventId, identity, session.isError]);

	useEffect(() => {
		const recheck = () => {
			if (document.visibilityState === "visible")
				void queryClient.invalidateQueries({ queryKey: ["auth", "session"] });
		};
		document.addEventListener("visibilitychange", recheck);
		return () => document.removeEventListener("visibilitychange", recheck);
	}, [queryClient]);

	const previousIdentity = useRef(identity);
	useEffect(() => {
		if (previousIdentity.current !== identity || session.isError) {
			previousIdentity.current = identity;
			invalidate();
			setEntries((previous) =>
				Object.fromEntries(
					Object.entries(previous).filter(([key]) => key === "public"),
				),
			);
			setOrg("");
			setEventId("");
			setMode(routeEventId && identity && !session.isError ? "internal" : "public");
			setDrafts((previous) => ({ public: previous.public ?? "" }));
			queryClient.removeQueries({ queryKey: ["assistant", "contexts"] });
		}
	}, [identity, session.isError, queryClient, routeEventId]);

	useEffect(() => {
		if (!open) return;
		const timer = window.setInterval(() => setClock(Date.now()), 30000);
		return () => window.clearInterval(timer);
	}, [open]);

	useEffect(() => {
		if (!open) return;
		const root = document.getElementById("root");
		if (root) root.inert = true;
		dialog.current?.focus();
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault();
				close();
			}
			if (event.key === "Tab" && dialog.current) {
				const items = Array.from(
					dialog.current.querySelectorAll<HTMLElement>(
						"button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled)",
					),
				).filter((item) => item.getClientRects().length > 0);
				const first = items[0];
				const last = items[items.length - 1];
				if (
					event.shiftKey &&
					(document.activeElement === first ||
						document.activeElement === dialog.current)
				) {
					event.preventDefault();
					last?.focus();
				} else if (!event.shiftKey && document.activeElement === last) {
					event.preventDefault();
					first?.focus();
				}
			}
		};
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("keydown", onKey);
			if (root) root.inert = false;
		};
	}, [open, close]);

	useLayoutEffect(() => {
		if (!open || !dialog.current || !backdrop.current || prefersReducedMotion()) return;

		closing.current = false;
		const isMobile = window.matchMedia("(max-width: 600px)").matches;
		const context = gsap.context(() => {
			const timeline = gsap.timeline({ defaults: { overwrite: "auto" } });
			timeline
				.fromTo(
					backdrop.current,
					{ autoAlpha: 0 },
					{ autoAlpha: 1, duration: 0.16, ease: "power1.out" },
					0,
				)
				.fromTo(
					dialog.current,
					{ autoAlpha: 0, y: isMobile ? 18 : 10, scale: isMobile ? 1 : 0.985 },
					{ autoAlpha: 1, y: 0, scale: 1, duration: 0.27, ease: "power3.out" },
					0,
				);
			if (headerAccent.current) {
				timeline.fromTo(
					headerAccent.current,
					{ scaleX: 0 },
					{ scaleX: 1, duration: 0.3, ease: "power2.out" },
					0.12,
				);
			}
			const greeting = dialog.current?.querySelector(".assistant-greeting-row");
			if (greeting) {
				timeline.fromTo(
					greeting,
					{ autoAlpha: 0, y: 8 },
					{ autoAlpha: 1, y: 0, duration: 0.22, ease: "power2.out" },
					0.08,
				);
			}
		}, dialog.current);
		return () => context.revert();
	}, [open]);

	useLayoutEffect(() => {
		if (!open || !content.current) return;
		const scopeChanged = previousScope.current !== scope;
		if (scopeChanged) {
			previousScope.current = scope;
			previousVisibleLength.current = visible.length;
		} else if (visible.length > previousVisibleLength.current) {
			const messages = Array.from(
				content.current.querySelectorAll<HTMLElement>(".assistant-answer"),
			).slice(previousVisibleLength.current);
			previousVisibleLength.current = visible.length;
			if (messages.length && !prefersReducedMotion()) {
				gsap.fromTo(
					messages,
					{ autoAlpha: 0, y: 9 },
					{
						autoAlpha: 1,
						y: 0,
						duration: 0.24,
						ease: "power2.out",
						stagger: 0.035,
						overwrite: "auto",
					},
				);
			}
		}
		if (prefersReducedMotion()) {
			content.current.scrollTop = content.current.scrollHeight;
		} else {
			gsap.to(content.current, {
				scrollTop: content.current.scrollHeight,
				duration: 0.22,
				ease: "power2.out",
				overwrite: "auto",
			});
		}
	}, [open, scope, visible.length, pendingQuestion]);

	useLayoutEffect(() => {
		if (!open || !pending || prefersReducedMotion()) return;
		const dots = dialog.current?.querySelectorAll(".assistant-typing-dot");
		if (!dots?.length) return;
		const tween = gsap.to(dots, {
			y: -3,
			opacity: 0.5,
			duration: 0.32,
			repeat: -1,
			yoyo: true,
			stagger: 0.12,
			ease: "power1.inOut",
		});
		return () => {
			tween.kill();
		};
	}, [open, pending]);

	async function sendQuestion(rawQuestion: string) {
		const question = rawQuestion.trim();
		if (!question || question.length > 500) {
			setError("Isi pertanyaan hingga 500 karakter.");
			return;
		}
		if (
			mode === "internal" &&
			(!validOrg ||
				!uuid.test(eventId) ||
				!choices.some((item) => item.id === eventId))
		) {
			setError("Pilih organisasi dan kegiatan yang dapat Anda akses.");
			return;
		}
		if (
			mode !== "public" &&
			(!identity || session.isFetching || session.isError)
		) {
			setError("Masuk kembali untuk menggunakan konteks ini.");
			return;
		}
		invalidate();
		const serial = generation.current;
		const abort = new AbortController();
		controller.current = abort;
		setPending(true);
		setPendingQuestion(question);
		try {
			const response =
				mode === "public"
					? await askPublicAssistant(
							{ question, ...(slug && { eventSlug: slug }) },
							abort.signal,
						)
					: await askInternal(
							{
								question,
								organizationId: org,
								eventId,
							},
							abort.signal,
						);
			if (serial !== generation.current || abort.signal.aborted) return;
			setEntries((previous) => ({
				...previous,
				[scope]: [...(previous[scope] ?? []), { question, response }],
			}));
			setDraft("");
		} catch (err) {
			if (serial === generation.current && !abort.signal.aborted) {
				setError(errorText(err));
				if (
					err instanceof ApiClientError &&
					[401, 403, 404].includes(err.status) &&
					mode !== "public"
				) {
					setEntries((previous) =>
						Object.fromEntries(
							Object.entries(previous).filter(([key]) => key === "public"),
						),
					);
					setDrafts((previous) => ({ public: previous.public ?? "" }));
					queryClient.removeQueries({ queryKey: ["assistant", "contexts"] });
				}
			}
		} finally {
			if (serial === generation.current) {
				setPending(false);
				setPendingQuestion("");
			}
		}
	}

	async function submit(e: FormEvent) {
		e.preventDefault();
		await sendQuestion(draft);
	}

	const manualListPath = mode === "internal" ? "/dashboard/events" : "/events";

	return createPortal(
		<>
			<button
				ref={trigger}
				type="button"
				className="assistant-trigger"
				onClick={() => setOpen(true)}
				aria-label="Buka chatbot Rangkai"
				aria-haspopup="dialog"
				aria-expanded={open}
			>
				<img src="/rangkai-icon.svg" alt="" width="28" height="28" />
			</button>

			{open && (
				<div
					ref={backdrop}
					className="assistant-backdrop"
					onMouseDown={(e) => {
						if (e.target === e.currentTarget) close();
					}}
				>
					<div
						ref={dialog}
						className="assistant-widget"
						role="dialog"
						aria-modal="true"
						aria-labelledby="assistant-title"
						tabIndex={-1}
					>
						<header className="assistant-header">
							<div className="assistant-header-profile">
								<div className="assistant-header-avatar" aria-hidden="true">
									<img src="/rangkai-icon.svg" alt="" width="22" height="22" />
								</div>
								<div className="assistant-header-info">
									<h2 id="assistant-title">Asisten Rangkai</h2>
								</div>
							</div>
							<button
								type="button"
								className="assistant-close-btn"
								onClick={close}
								aria-label="Tutup chatbot"
								title="Tutup chatbot"
							>
								<X aria-hidden="true" size={20} strokeWidth={2} />
							</button>
							<span ref={headerAccent} className="assistant-header-accent" aria-hidden="true" />
						</header>

						<div ref={content} className="assistant-content">
							<div className="assistant-msg-row bot assistant-greeting-row">
								<div className="assistant-msg-avatar" aria-hidden="true">
									<img src="/rangkai-icon.svg" alt="" width="18" height="18" />
								</div>
								<div className="assistant-msg-bubble bot">
									<p className="assistant-greeting-text">
										Halo, saya Asisten Rangkai. Apa yang ingin Anda ketahui?
									</p>
								</div>
							</div>

							{/* Conversation Log */}
							<div
								className="assistant-history"
								role="log"
								aria-label="Percakapan"
								aria-live="polite"
							>
								{visible.map((entry, index) => {
									const categoryLabel =
										entry.response.intent === "help"
											? "Panduan penggunaan"
											: mode === "public"
												? "Informasi publik"
												: "Data internal";

									return (
										<section key={index} className="assistant-answer">
											{/* User Question Bubble */}
											<div className="assistant-msg-row user">
												<p className="assistant-message-user">
													{entry.question}
												</p>
											</div>

											{/* Assistant Answer & Grounded Source Cards */}
											<div className="assistant-msg-row bot">
												<div className="assistant-msg-avatar" aria-hidden="true">
													<img
														src="/rangkai-icon.svg"
														alt=""
														width="18"
														height="18"
													/>
												</div>
												<div className="assistant-bot-stack">
													<div className="assistant-message-reply">
														<span className="assistant-reply-badge">
															{categoryLabel}
														</span>
														<p className="assistant-reply-text">
															{entry.response.answer}
														</p>
													</div>

													{entry.response.sources.length > 0 && (
														<div className="assistant-sources-list">
															{entry.response.sources.map((source) => {
																const targetUrl =
																	"url" in source
																		? source.url
																		: source.publicUrl;
																const showHelpDetail =
																	"answer" in source &&
																	source.answer.trim() !==
																		entry.response.answer.trim();

																return (
																	<article
																		key={source.sourceId}
																		className="assistant-source-card"
																	>
																		<div className="assistant-source-header">
																			<Link
																				to={targetUrl}
																				className="assistant-source-link"
																				onClick={close}
																			>
																				{source.title}
																			</Link>
																		</div>

																		{ "answer" in source ? (
																			showHelpDetail ? (
																				<p className="assistant-source-meta">
																					{source.answer}
																				</p>
																			) : null
																		) : "facts" in source ? (
																			<>
																				<p className="assistant-source-meta">
																					{source.facts.isSimulation
																						? "Simulasi · "
																						: ""}
																					{source.kind === "road" &&
																					(!source.facts.expiresAt ||
																						!Number.isFinite(
																							Date.parse(source.facts.expiresAt),
																						) ||
																						Date.parse(source.facts.expiresAt) <=
																							clock)
																						? "Belum terkonfirmasi"
																						: "status" in source.facts
																							? statusLabel(source.facts.status)
																							: ""}
																				</p>
																				{source.kind === "event" && (
																					<p className="assistant-source-meta">
																						Mulai: {date(source.facts.startsAt)};
																						selesai: {date(source.facts.endsAt)}
																					</p>
																				)}
																				{source.kind === "road" && (
																					<p className="assistant-source-meta">
																						Diamati:{" "}
																						{date(source.facts.observedAt)};
																						berlaku sampai:{" "}
																						{date(source.facts.expiresAt)}
																					</p>
																				)}
																				{source.kind === "cleanup" && (
																					<p className="assistant-source-meta">
																						Tenggat: {date(source.facts.dueAt)}
																					</p>
																				)}
																				{source.kind === "waste" && (
																					<p className="assistant-source-meta">
																						{String(source.facts.category)} ·{" "}
																						{String(
																							source.facts.measurementMethod,
																						)}{" "}
																						·{" "}
																						{String(
																							source.facts.quantityKg ?? "—",
																						)}{" "}
																						kg ·{" "}
																						{String(
																							source.facts.sackCount ?? "—",
																						)}{" "}
																						karung
																					</p>
																				)}
																			</>
																		) : (
																			<>
																				<p className="assistant-source-meta">
																					{source.isSimulation
																						? "Simulasi · "
																						: ""}
																					{source.sourceId.startsWith("road:") &&
																					(!source.expiresAt ||
																						!Number.isFinite(
																							Date.parse(source.expiresAt),
																						) ||
																						Date.parse(source.expiresAt) <= clock)
																						? "Belum terkonfirmasi"
																						: statusLabel(source.status)}
																				</p>
																				{source.observedAt && (
																					<p className="assistant-source-meta">
																						Diamati: {date(source.observedAt)};
																						berlaku sampai:{" "}
																						{date(source.expiresAt)}
																					</p>
																				)}
																				{"startsAt" in source && (
																					<p className="assistant-source-meta">
																						Mulai: {date(source.startsAt)};
																						selesai: {date(source.endsAt)}
																					</p>
																				)}
																				{"summary" in source && (
																					<p className="assistant-source-meta">
																						Tugas diverifikasi:{" "}
																						{source.summary.verifiedTasks} dari{" "}
																						{source.summary.totalTasks}
																					</p>
																				)}
																			</>
																		)}
																	</article>
																);
															})}
														</div>
													)}
												</div>
											</div>
										</section>
									);
								})}
								{pendingQuestion && (
									<div className="assistant-msg-row user assistant-pending-message">
										<p className="assistant-message-user">{pendingQuestion}</p>
									</div>
								)}
								{pending && (
									<div className="assistant-msg-row bot" role="status" aria-live="polite">
										<div className="assistant-msg-avatar" aria-hidden="true">
											<img src="/rangkai-icon.svg" alt="" width="18" height="18" />
										</div>
										<div className="assistant-message-reply assistant-typing-bubble">
											<span className="sr-only">Asisten sedang menyiapkan jawaban</span>
											<span className="assistant-typing-dots" aria-hidden="true">
												<i className="assistant-typing-dot" />
												<i className="assistant-typing-dot" />
												<i className="assistant-typing-dot" />
											</span>
										</div>
									</div>
								)}
							</div>

						</div>

						<form className="assistant-compose" onSubmit={submit}>
							{error && (
								<div role="alert" className="assistant-error-alert">
									<p>{error}</p>
									<Link to={manualListPath} onClick={close}>
										Buka daftar kegiatan
									</Link>
								</div>
							)}
							<p className="assistant-privacy">
								Pertanyaan diproses layanan AI eksternal. Jangan kirim data pribadi.
							</p>
							<div className="assistant-compose-row">
								<label className="assistant-compose-label">
									<span className="sr-only">Pesan</span>
									<textarea
										value={draft}
										onChange={(event) => setDraft(event.target.value)}
										onKeyDown={(event) => {
											if (
												event.key === "Enter" &&
												!event.shiftKey &&
												!event.nativeEvent.isComposing
											) {
												event.preventDefault();
												void sendQuestion(draft);
											}
										}}
										placeholder="Tulis pesan..."
										aria-label="Tulis pesan"
										maxLength={500}
										rows={2}
										disabled={pending}
									/>
								</label>
								<button
									type="submit"
									className="assistant-send-btn"
									disabled={pending || !draft.trim()}
									aria-label={pending ? "Menyiapkan jawaban" : "Kirim pesan"}
									title="Kirim pesan"
								>
									<Send aria-hidden="true" size={19} strokeWidth={2} />
								</button>
							</div>
						</form>
					</div>
				</div>
			)}
		</>,
		document.body,
	);
}
