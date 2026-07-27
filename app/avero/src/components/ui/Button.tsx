type ButtonProps = {
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "ghost";
};

export default function Button({ children, variant = "primary" }: ButtonProps) {
  const base = "px-4 py-2 rounded-lg font-medium transition";

  const styles = {
    primary: "bg-white text-black hover:opacity-80",
    secondary: "border border-white text-white hover:bg-white hover:text-black",
    ghost: "text-white hover:bg-ink/10",
  };

  return (
    <button className={`${base} ${styles[variant]}`}>
      {children}
    </button>
  );
}