import React from 'react';
import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router';

export interface FlowButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  text?: string;
  to?: string;
  variant?: "theme" | "mono";
  className?: string;
}

export function FlowButton({
  text = "Modern Button",
  to,
  variant = "theme",
  className = "",
  onClick,
  disabled,
  type = "button",
  ...props
}: FlowButtonProps) {
  const isTheme = variant === "theme";

  const content = (
    <>
      {/* Left arrow (arr-2) */}
      <ArrowRight 
        className={[
          "absolute w-4 h-4 left-[-25%] fill-none z-[9] group-hover:left-4 transition-all duration-[800ms] ease-[cubic-bezier(0.34,1.56,0.64,1)]",
          isTheme
            ? "stroke-accent-warm dark:stroke-primary-fixed-dim group-hover:stroke-white dark:group-hover:stroke-on-primary-fixed"
            : "stroke-[#111111] dark:stroke-[#ececec] group-hover:stroke-white dark:group-hover:stroke-[#111111]",
        ].join(" ")}
      />

      {/* Text */}
      <span
        className={[
          "relative z-[1] -translate-x-3 group-hover:translate-x-3 transition-all duration-[800ms] ease-out whitespace-nowrap font-medium",
          isTheme
            ? "text-on-surface dark:text-surface-container-lowest group-hover:text-white dark:group-hover:text-on-primary-fixed"
            : "text-[#111111] dark:text-[#ececec] group-hover:text-white dark:group-hover:text-[#111111]",
        ].join(" ")}
      >
        {text}
      </span>

      {/* Expanding circle background with theme accent */}
      <span
        className={[
          "absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 rounded-[50%] opacity-0 group-hover:w-[280px] group-hover:h-[280px] group-hover:opacity-100 transition-all duration-[800ms] ease-[cubic-bezier(0.19,1,0.22,1)] pointer-events-none",
          isTheme
            ? "bg-accent-warm dark:bg-primary-fixed-dim"
            : "bg-[#111111] dark:bg-[#ececec]",
        ].join(" ")}
      />

      {/* Right arrow (arr-1) */}
      <ArrowRight 
        className={[
          "absolute w-4 h-4 right-4 fill-none z-[9] group-hover:right-[-25%] transition-all duration-[800ms] ease-[cubic-bezier(0.34,1.56,0.64,1)]",
          isTheme
            ? "stroke-accent-warm dark:stroke-primary-fixed-dim group-hover:stroke-white dark:group-hover:stroke-on-primary-fixed"
            : "stroke-[#111111] dark:stroke-[#ececec] group-hover:stroke-white dark:group-hover:stroke-[#111111]",
        ].join(" ")}
      />
    </>
  );

  const baseClasses = [
    "group relative inline-flex items-center justify-center gap-1 overflow-hidden rounded-[100px] border-[1.5px] px-8 py-3 text-sm font-semibold cursor-pointer transition-all duration-[600ms] ease-[cubic-bezier(0.23,1,0.32,1)] hover:border-transparent hover:rounded-[12px] active:scale-[0.95] select-none",
    isTheme
      ? "border-accent-warm/40 dark:border-primary-fixed-dim/40 bg-accent-warm/[0.05] dark:bg-primary-fixed-dim/[0.08] hover:shadow-md hover:shadow-accent-warm/20 dark:hover:shadow-primary-fixed-dim/20"
      : "border-[#333333]/40 dark:border-white/30 bg-transparent text-[#111111] dark:text-[#ececec]",
  ].join(" ");

  if (to) {
    return (
      <Link to={to} className={`${baseClasses} ${className}`}>
        {content}
      </Link>
    );
  }

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`${baseClasses} ${className}`}
      {...props}
    >
      {content}
    </button>
  );
}

export default FlowButton;
