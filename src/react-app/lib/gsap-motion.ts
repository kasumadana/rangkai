import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import type { RefObject } from "react";

gsap.registerPlugin(useGSAP, ScrollTrigger);

function isReducedMotionPreferred(): boolean {
	if (typeof window === "undefined" || !window.matchMedia) return false;
	return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Route-level transition hook for shell containers when navigating between pages.
 * Clears transform upon completion so fixed/sticky descendants keep viewport context.
 */
export function useGsapRouteTransition(
	containerRef: RefObject<HTMLElement | null>,
	pathname: string,
) {
	useGSAP(
		() => {
			const el = containerRef.current;
			if (!el) return;

			if (isReducedMotionPreferred()) {
				gsap.fromTo(
					el,
					{ opacity: 0.92 },
					{ opacity: 1, duration: 0.18, ease: "power1.out" },
				);
				return;
			}

			// Skip vertical shift on full-screen map console (/peta) so WebGL canvas stays locked
			if (pathname === "/peta") {
				gsap.fromTo(
					el,
					{ opacity: 0 },
					{
						opacity: 1,
						duration: 0.35,
						ease: "power2.out",
						clearProps: "opacity",
					},
				);
				return;
			}

			gsap.fromTo(
				el,
				{ opacity: 0, y: 12 },
				{
					opacity: 1,
					y: 0,
					duration: 0.42,
					ease: "power3.out",
					clearProps: "transform,opacity",
				},
			);
		},
		{ dependencies: [pathname] },
	);
}

/**
 * Choreography for the Landing Page (`/`):
 * - Hero staggered entrance + image settle
 * - Hero photo scroll parallax scrub
 * - Map console frame scroll expansion
 * - Schedule cards ScrollTrigger batch reveal
 * - Footer scroll reveal
 */
export function useGsapLandingScroll(
	containerRef: RefObject<HTMLElement | null>,
	deps: unknown[] = [],
) {
	useGSAP(
		() => {
			const root = containerRef.current;
			if (!root || isReducedMotionPreferred()) return;

			const heroItems = root.querySelectorAll<HTMLElement>(
				'[data-gsap="hero-item"]',
			);
			const heroImage = root.querySelector<HTMLElement>(".hero-full-img");

			if (heroItems.length > 0) {
				gsap.fromTo(
					heroItems,
					{ y: 22 },
					{
						y: 0,
						duration: 0.64,
						stagger: 0.08,
						ease: "power3.out",
						clearProps: "transform",
					},
				);
			}

			// Hero image stays completely calm and static from initial render ("diem aja")
			if (heroImage) {
				gsap.set(heroImage, { clearProps: "all" });
			}

			const mapSection = root.querySelector<HTMLElement>(
				".landing-map-section",
			);
			const mapInner = root.querySelector<HTMLElement>(".landing-map-inner");
			if (mapSection && mapInner) {
				gsap.fromTo(
					mapInner,
					{ opacity: 0.85, y: 18 },
					{
						opacity: 1,
						y: 0,
						duration: 0.65,
						ease: "power2.out",
						clearProps: "transform",
						onComplete: () => {
							window.dispatchEvent(new Event("resize"));
						},
						scrollTrigger: {
							trigger: mapSection,
							start: "top 88%",
							toggleActions: "play none none none",
							onEnter: () => {
								window.dispatchEvent(new Event("resize"));
							},
						},
					},
				);
			}

			const scheduleTopBar =
				root.querySelector<HTMLElement>(".schedule-top-bar");
			if (scheduleTopBar) {
				gsap.fromTo(
					scheduleTopBar,
					{ opacity: 0, y: 20 },
					{
						opacity: 1,
						y: 0,
						duration: 0.56,
						ease: "power3.out",
						clearProps: "transform",
						scrollTrigger: {
							trigger: scheduleTopBar,
							start: "top 88%",
							toggleActions: "play none none none",
						},
					},
				);
			}

			const scrollCards = root.querySelectorAll<HTMLElement>(
				'[data-gsap="scroll-card"]',
			);
			if (scrollCards.length > 0) {
				gsap.set(scrollCards, { opacity: 0, y: 24 });
				ScrollTrigger.batch(scrollCards, {
					start: "top 90%",
					once: true,
					onEnter: (batch) => {
						gsap.to(batch, {
							opacity: 1,
							y: 0,
							duration: 0.52,
							stagger: 0.07,
							ease: "power3.out",
							overwrite: true,
							clearProps: "transform",
						});
					},
				});
			}

			const footerInner = root.querySelector<HTMLElement>(".footer-inner");
			if (footerInner) {
				gsap.fromTo(
					footerInner,
					{ opacity: 0, y: 18 },
					{
						opacity: 1,
						y: 0,
						duration: 0.55,
						ease: "power2.out",
						clearProps: "transform",
						scrollTrigger: {
							trigger: footerInner,
							start: "top 92%",
							toggleActions: "play none none none",
						},
					},
				);
			}

			ScrollTrigger.refresh();
		},
		{ scope: containerRef, dependencies: deps },
	);
}

/**
 * Universal page entry + scroll-triggered section/card reveal hook for all inner pages:
 * - Animates `[data-gsap="reveal"]` immediately on mount with stagger
 * - Animates `[data-gsap="scroll-section"]` when scrolling into view
 * - Batches `[data-gsap="scroll-card"]` cards when scrolling into view
 */
export function useGsapPageReveal(
	containerRef: RefObject<HTMLElement | null>,
	deps: unknown[] = [],
) {
	useGSAP(
		() => {
			const root = containerRef.current;
			if (!root || isReducedMotionPreferred()) return;

			const revealItems = root.querySelectorAll<HTMLElement>(
				'[data-gsap="reveal"]',
			);
			if (revealItems.length > 0) {
				gsap.fromTo(
					revealItems,
					{ opacity: 0, y: 16 },
					{
						opacity: 1,
						y: 0,
						duration: 0.48,
						stagger: 0.06,
						ease: "power3.out",
						clearProps: "transform",
					},
				);
			}

			const scrollSections = root.querySelectorAll<HTMLElement>(
				'[data-gsap="scroll-section"]',
			);
			scrollSections.forEach((section) => {
				gsap.fromTo(
					section,
					{ opacity: 0, y: 20 },
					{
						opacity: 1,
						y: 0,
						duration: 0.54,
						ease: "power3.out",
						clearProps: "transform",
						scrollTrigger: {
							trigger: section,
							start: "top 88%",
							toggleActions: "play none none none",
						},
					},
				);
			});

			const scrollCards = root.querySelectorAll<HTMLElement>(
				'[data-gsap="scroll-card"]',
			);
			if (scrollCards.length > 0) {
				gsap.set(scrollCards, { opacity: 0, y: 20 });
				ScrollTrigger.batch(scrollCards, {
					start: "top 91%",
					once: true,
					onEnter: (batch) => {
						gsap.to(batch, {
							opacity: 1,
							y: 0,
							duration: 0.48,
							stagger: 0.06,
							ease: "power3.out",
							overwrite: true,
							clearProps: "transform",
						});
					},
				});
			}

			ScrollTrigger.refresh();
		},
		{ scope: containerRef, dependencies: deps },
	);
}
