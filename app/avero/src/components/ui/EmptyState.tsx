type EmptyStateProps = {
  icon?: React.ReactNode;
  title: string;
  titleAs?: "h1" | "h2";
  description: string;
  children?: React.ReactNode;
};

/**
 * A calm, inspiring empty state (blueprint §6 — "Empty States Should Inspire",
 * design-system §10).
 *
 * An empty state is never an error; it is the beginning of a story. This
 * presentational primitive gives any screen a consistent, welcoming empty
 * frame: an optional emblem, an emotional heading, a supporting line, and an
 * action slot (typically a primary button or link).
 *
 * Generic by design so the Spaces dashboard, the invitations page, and any
 * future list can share the same calm voice without duplicating markup. The
 * heading level is configurable via `titleAs` so each screen keeps exactly one
 * H1 (auth-design §8).
 */
export default function EmptyState({
  icon,
  title,
  titleAs = "h2",
  description,
  children,
}: EmptyStateProps) {
  const Title = titleAs;
  return (
    <div className="flex flex-col items-center px-6 py-16 text-center">
      {icon && (
        <div
          className="mb-6 flex h-14 w-14 items-center justify-center rounded-full bg-accent-soft text-accent-400"
          aria-hidden="true"
        >
          {icon}
        </div>
      )}
      <Title className="text-2xl font-bold leading-tight text-ink sm:text-3xl">
        {title}
      </Title>
      <p className="mt-3 max-w-sm text-sm text-ink-muted sm:text-base">
        {description}
      </p>
      {children && <div className="mt-8 w-full max-w-xs">{children}</div>}
    </div>
  );
}
