import { Link } from "react-router";
import { memoryCreatePath } from "../../constants/routes";

type CreateMemoryButtonProps = {
  /** The Space ID for building the create memory route */
  spaceId: string;
  /** Additional className for spacing/layout */
  className?: string;
};

/**
 * Prominent "Create Memory" button with accent fill and plus icon.
 * Matches Stitch source: accent-filled, + icon, hover lift, active scale.
 */
export default function CreateMemoryButton({ spaceId, className = "" }: CreateMemoryButtonProps) {
  return (
    <Link
      to={memoryCreatePath(spaceId)}
      className={`bg-accent-warm dark:bg-primary-fixed text-canvas-warm dark:text-on-primary-fixed font-body-sm text-body-sm font-medium px-6 py-3 rounded-lg flex items-center gap-2 hover:bg-opacity-90 hover:-translate-y-0.5 transition-all shadow-sm active:scale-95 whitespace-nowrap ${className}`}
    >
      <span className="material-symbols-outlined text-[18px]" data-icon="add">
        add
      </span>
      Create Memory
    </Link>
  );
}