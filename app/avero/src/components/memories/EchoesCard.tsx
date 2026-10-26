import { Link } from "react-router";
import { memoryDetailPath } from "../../constants/routes";
import type { Memory } from "../../types/memory";
import type { Media } from "../../types/media";

type EchoesCardProps = {
  memory: Memory;
  spaceId: string;
  thumbnails: Media[];
  intervalLabel: string;
};

export default function EchoesCard({
  memory,
  spaceId,
  thumbnails,
  intervalLabel,
}: EchoesCardProps) {
  const thumbnailUrl =
    thumbnails[0]?.thumbnail_grid_path ??
    thumbnails[0]?.thumbnail_path ??
    thumbnails[0]?.url;

  return (
    <div className="hover-lift min-w-[280px] md:min-w-[320px] bg-card-warm dark:bg-card-dark border border-outline-variant/40 dark:border-inverse-surface rounded-xl p-4 flex gap-4 items-center shadow-stone cursor-pointer snap-start group">
      {thumbnailUrl ? (
        <img
          alt=""
          className="w-16 h-16 rounded-lg object-cover bg-surface-container dark:bg-inverse-surface opacity-90 group-hover:opacity-100 transition-opacity shrink-0"
          src={thumbnailUrl}
        />
      ) : (
        <div className="w-16 h-16 rounded-lg bg-surface-container dark:bg-inverse-surface flex items-center justify-center text-on-surface-variant/50 shrink-0">
          <span className="material-symbols-outlined text-2xl" data-icon="photo">photo</span>
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="font-mono-data text-mono-data tabular-nums text-accent-warm dark:text-primary-fixed-dim mb-1 transition-colors duration-300">
          {intervalLabel}
        </p>
        <p className="font-serif text-[16px] text-on-surface dark:text-surface-container-lowest font-medium truncate transition-colors duration-300">
          <Link
            to={memoryDetailPath(spaceId, memory.id)}
            className="rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60"
          >
            {memory.title}
          </Link>
        </p>
      </div>
      <span className="material-symbols-outlined text-outline-variant/50 dark:text-secondary-fixed-dim group-hover:text-accent-warm dark:group-hover:text-primary-fixed-dim transition-colors" data-icon="chevron_right">
        chevron_right
      </span>
    </div>
  );
}