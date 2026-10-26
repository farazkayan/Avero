import {
  HeartFillIcon,
  SmileyGrinIcon,
  FlameIcon,
  SmileyIcon,
  ThumbsupIcon,
  RocketIcon,
} from "@primer/octicons-react";
import type { ReactionType } from "../../types/reaction";

type ReactionIconProps = {
  type: ReactionType;
  className?: string;
  size?: number;
};

/**
 * Reaction icons directly from GitHub Primer Octicons.
 * Clean, standard, and perfectly styled for both dark and light modes.
 */
export default function ReactionIcon({
  type,
  className = "",
  size = 20,
}: ReactionIconProps) {
  switch (type) {
    case "heart":
      return (
        <HeartFillIcon
          size={size}
          className={`text-rose-500 dark:text-rose-400 ${className}`}
          aria-hidden="true"
        />
      );
    case "laugh":
      return (
        <SmileyGrinIcon
          size={size}
          className={`text-amber-500 dark:text-amber-400 ${className}`}
          aria-hidden="true"
        />
      );
    case "fire":
      return (
        <FlameIcon
          size={size}
          className={`text-orange-500 dark:text-orange-400 ${className}`}
          aria-hidden="true"
        />
      );
    case "tearful":
      return (
        <SmileyIcon
          size={size}
          className={`text-pink-500 dark:text-pink-400 ${className}`}
          aria-hidden="true"
        />
      );
    case "clap":
      return (
        <ThumbsupIcon
          size={size}
          className={`text-yellow-600 dark:text-yellow-400 ${className}`}
          aria-hidden="true"
        />
      );
    case "surprised":
      return (
        <RocketIcon
          size={size}
          className={`text-purple-500 dark:text-purple-400 ${className}`}
          aria-hidden="true"
        />
      );
    default:
      return null;
  }
}
