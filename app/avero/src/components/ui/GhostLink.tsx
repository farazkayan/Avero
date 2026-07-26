import { Link } from "react-router";

/**
 * Props for {@link GhostLink}.
 *
 * The component is polymorphic so it is not coupled to a single navigation
 * approach:
 * - Use `to` for internal client-side navigation (renders a React Router
 *   `<Link>`).
 * - Use `href` for external links or full-page navigations (renders a plain
 *   `<a>`).
 *
 * Exactly one of `to` or `href` must be provided.
 */
type GhostLinkProps = {
  children: React.ReactNode;
  className?: string;
} & (
  | { to: string; href?: never }
  | { to?: never; href: string }
);

const linkClassName = [
  "inline-flex items-center justify-center text-sm font-medium",
  "text-ink-muted transition-colors duration-200",
  "hover:text-accent-400 focus:outline-none focus-visible:text-accent-400",
  "focus-visible:ring-2 focus-visible:ring-accent-500/60 rounded-md",
].join(" ");

/**
 * Minimal text-style navigation between auth screens and secondary actions
 * (auth-design §5). Visually subordinate so the primary path is never
 * ambiguous. Links shift to the accent tone on hover/focus.
 *
 * Renders a React Router `<Link>` when `to` is provided (internal navigation)
 * or a plain `<a>` when `href` is provided (external links).
 */
export default function GhostLink({ children, className = "", ...props }: GhostLinkProps) {
  const combinedClassName = className
    ? `${linkClassName} ${className}`
    : linkClassName;

  if ("to" in props && props.to !== undefined) {
    return (
      <Link to={props.to} className={combinedClassName}>
        {children}
      </Link>
    );
  }

  return (
    <a href={props.href} className={combinedClassName}>
      {children}
    </a>
  );
}
