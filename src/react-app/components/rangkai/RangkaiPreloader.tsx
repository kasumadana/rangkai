import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { useEffect, useRef, useState } from "react";
import { markPreloaderShown, shouldPlayPreloader } from "../../lib/preloader";

gsap.registerPlugin(useGSAP);

export interface RangkaiPreloaderProps {
	onComplete?: () => void;
	onRevealStart?: () => void;
	preloaderKey?: string;
}

export function RangkaiPreloader({
	onComplete,
	onRevealStart,
	preloaderKey = "landing",
}: RangkaiPreloaderProps) {
	const [isVisible, setIsVisible] = useState<boolean>(() =>
		shouldPlayPreloader(preloaderKey),
	);
	const [assetsReady, setAssetsReady] = useState(false);

	const overlayRef = useRef<HTMLDivElement>(null);
	const brandRef = useRef<HTMLDivElement>(null);
	const barRef = useRef<HTMLDivElement>(null);

	// Lock scroll while preloader is active
	useEffect(() => {
		if (!isVisible) return;
		const prevOverflow = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		return () => {
			document.body.style.overflow = prevOverflow;
		};
	}, [isVisible]);

	useEffect(() => {
		if (!isVisible) return;

		let isCancelled = false;
		const minTimer = new Promise<void>((resolve) => {
			window.setTimeout(resolve, preloaderKey === "peta" ? 500 : 450);
		});

		const promises: Promise<void>[] = [minTimer];

		if (preloaderKey === "landing") {
			const heroImagePromise = new Promise<void>((resolve) => {
				const img = new Image();
				const timeoutId = window.setTimeout(resolve, 900);
				img.onload = () => {
					window.clearTimeout(timeoutId);
					resolve();
				};
				img.onerror = () => {
					window.clearTimeout(timeoutId);
					resolve();
				};
				img.src = "/images/bali-culture-hero.jpg";
			});
			promises.push(heroImagePromise);
		}

		void Promise.all(promises).then(() => {
			if (!isCancelled) {
				setAssetsReady(true);
			}
		});

		return () => {
			isCancelled = true;
		};
	}, [isVisible, preloaderKey]);

	useGSAP(
		() => {
			if (!isVisible || !overlayRef.current) return;

			const prefersReducedMotion = window.matchMedia(
				"(prefers-reduced-motion: reduce)",
			).matches;

			if (prefersReducedMotion) {
				if (assetsReady) {
					gsap.to(overlayRef.current, {
						opacity: 0,
						duration: 0.25,
						ease: "power1.out",
						onComplete: () => {
							markPreloaderShown(preloaderKey);
							setIsVisible(false);
							onComplete?.();
						},
					});
				}
				return;
			}

			if (!assetsReady) {
				gsap.fromTo(
					brandRef.current,
					{ opacity: 0, y: 10 },
					{ opacity: 1, y: 0, duration: 0.38, ease: "power3.out" },
				);
				gsap.fromTo(
					barRef.current,
					{ scaleX: 0.08, transformOrigin: "left center" },
					{
						scaleX: 0.72,
						duration: 0.65,
						ease: "power2.out",
						transformOrigin: "left center",
					},
				);
				return;
			}

			const tl = gsap.timeline({
				onComplete: () => {
					markPreloaderShown(preloaderKey);
					setIsVisible(false);
					onComplete?.();
				},
			});

			tl.to(barRef.current, {
				scaleX: 1,
				duration: 0.28,
				ease: "power2.out",
				transformOrigin: "left center",
			})
				.to(
					brandRef.current,
					{
						y: -12,
						opacity: 0,
						duration: 0.28,
						ease: "power2.in",
					},
					"+=0.06",
				)
				.to(
					overlayRef.current,
					{
						yPercent: -100,
						duration: 0.75,
						ease: "power4.inOut",
						onStart: () => {
							onRevealStart?.();
						},
					},
					"-=0.12",
				);
		},
		{ dependencies: [isVisible, assetsReady], scope: overlayRef },
	);

	if (!isVisible) return null;

	return (
		<div
			ref={overlayRef}
			className="rangkai-preloader"
			aria-hidden="true"
			style={{
				position: "fixed",
				inset: 0,
				zIndex: 9999,
				backgroundColor: "#FBFBFA",
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
			}}
		>
			<div ref={brandRef} className="rangkai-preloader-inner">
				<div className="rangkai-preloader-brand" style={{ justifyContent: "center" }}>
					<img
						src="/logo.png"
						alt="Rangkai Emblem"
						width={38}
						height={38}
						className="rangkai-preloader-logo"
					/>
				</div>
				<div className="rangkai-preloader-track">
					<div ref={barRef} className="rangkai-preloader-bar" />
				</div>
			</div>
		</div>
	);
}
