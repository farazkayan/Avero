import { Link } from "react-router";
import { AUTHENTICATED_HOME_PATH } from "../../constants/routes";

type BackLinkProps = {
  /** Optional custom destination (defaults to Spaces Dashboard) */
  to?: string;
  /** Optional custom label (defaults to "Back to Spaces") */
  label?: string;
  /** Additional className for spacing/layout */
  className?: string;
};

/**
 * Back link with monospace label style and sliding arrow on hover.
 * Matches Stitch source: "← Back to Spaces" with arrow that slides left on hover.
 */
export default function BackLink({ to = AUTHENTICATED_HOME_PATH, label = "Back to Spaces", className = "" }: BackLinkProps) {
  return (
    <Link
      to={to}
      className={`inline-flex items-center gap-2 font-mono-label text-mono-label text-on-surface-variant dark:text-secondary-fixed-dim hover:text-accent-warm dark:hover:text-primary-fixed-dim transition-colors group uppercase tracking-wider ${className}`}
    >
      <span className="material-symbols-outlined text-[16px] group-hover:-translate-x-1 transition-transform" data-icon="arrow_back">
        arrow_back
      </span>
      {label}
    </Link>
  );
}