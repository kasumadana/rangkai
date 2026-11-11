import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Icon } from "@astryxdesign/core/Icon";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { Spinner } from "@astryxdesign/core/Spinner";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { Inbox, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";
import { ApiClientError } from "../../lib/api-client";

/**
 * Standardized async view states per AGENTS.md §18:
 * Every async operation needs:
 * - Loading state
 * - Success state
 * - Error state + retry/recovery path
 * - Empty state
 */

export function LoadingStateBlock({
	label = "Memuat data operasional...",
	rows = 3,
}: {
	label?: string;
	rows?: number;
}) {
	return (
		<Card padding={5}>
			<VStack gap={4} role="status" aria-live="polite">
				<HStack gap={2} vAlign="center">
					<Spinner size="sm" label={label} />
				</HStack>
				<VStack gap={2}>
					{Array.from({ length: rows }).map((_, idx) => (
						<Skeleton
							key={idx}
							height={idx === 0 ? 24 : 18}
							width={idx === rows - 1 ? "65%" : "100%"}
						/>
					))}
				</VStack>
			</VStack>
		</Card>
	);
}

export function ErrorStateBanner({
	title = "Data belum dapat dimuat",
	error,
	onRetry,
	fallbackAction,
}: {
	title?: string;
	error?: unknown;
	onRetry?: () => void;
	fallbackAction?: ReactNode;
}) {
	const message =
		error instanceof ApiClientError
			? `${error.message} (Kode: ${error.code}, ID: ${error.requestId})`
			: error instanceof Error
				? error.message
				: "Terjadi gangguan komunikasi dengan server. Silakan coba lagi.";

	return (
		<Banner
			status="error"
			collapsible={false}
			title={title}
			description={message}
			endContent={
				<HStack gap={2} vAlign="center" wrap="wrap">
					{onRetry ? (
						<Button
							variant="secondary"
							size="sm"
							label="Coba Lagi"
							icon={<Icon icon={RefreshCw} size="sm" />}
							onClick={onRetry}
						/>
					) : null}
					{fallbackAction}
				</HStack>
			}
		/>
	);
}

export function EmptyStateCard({
	title,
	description,
	icon,
	actions,
}: {
	title: string;
	description?: string;
	icon?: ReactNode;
	actions?: ReactNode;
}) {
	return (
		<Card padding={6}>
			<EmptyState
				title={title}
				description={description}
				icon={icon ?? <Icon icon={Inbox} size="lg" color="secondary" />}
				actions={actions}
			/>
		</Card>
	);
}
