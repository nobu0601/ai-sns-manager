export function Alert({ tone = "error", title, messages = [], children }: {
  tone?: "error" | "success" | "info" | "warning";
  title?: string;
  messages?: string[];
  children?: React.ReactNode;
}) {
  const classes = {
    error: "border-rose-200 bg-rose-50 text-rose-800",
    success: "border-emerald-200 bg-emerald-50 text-emerald-800",
    info: "border-sky-200 bg-sky-50 text-sky-800",
    warning: "border-amber-200 bg-amber-50 text-amber-900",
  }[tone];
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`rounded-lg border px-4 py-3 text-sm ${classes}`}>
      {title && <p className="font-semibold">{title}</p>}
      {messages.length > 0 && (
        <ul className="mt-1 list-disc space-y-0.5 pl-5">
          {messages.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}
      {children}
    </div>
  );
}
