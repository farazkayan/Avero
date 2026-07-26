type AuthFormPanelProps = {
  children: React.ReactNode;
  className?: string;
};

/**
 * The centered, width-constrained container that holds a form and its
 * surrounding copy (auth-design §5). Enforces consistent form width
 * (~400–440px) and vertical rhythm so every auth screen feels identical.
 */
export default function AuthFormPanel({
  children,
  className = "",
}: AuthFormPanelProps) {
  return (
    <div className={`w-full max-w-[420px] ${className}`}>{children}</div>
  );
}
