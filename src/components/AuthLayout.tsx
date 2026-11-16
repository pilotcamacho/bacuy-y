import type { FormEvent, ReactNode } from "react";
import { useId } from "react";
import { useTranslation } from "react-i18next";

/** Centered card used by every auth screen. */
export function AuthLayout({
  title,
  children,
  footer,
}: {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="mx-auto flex min-h-full w-full max-w-sm flex-col justify-center px-4 py-10">
      <p className="mb-6 text-center text-lg font-semibold">{t("app.name")}</p>
      <h1 className="mb-4 text-xl font-semibold">{title}</h1>
      {children}
      {footer && <div className="mt-6 space-y-2 text-sm">{footer}</div>}
    </div>
  );
}

export function AuthForm({
  onSubmit,
  children,
}: {
  onSubmit: () => void | Promise<void>;
  children: ReactNode;
}) {
  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        void onSubmit();
      }}
    >
      {children}
    </form>
  );
}

export function TextField({
  label,
  value,
  onChange,
  type = "text",
  autoComplete,
  hint,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: "text" | "email" | "password";
  autoComplete?: string;
  hint?: string;
  inputMode?: "numeric" | "email" | "text";
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        autoComplete={autoComplete}
        inputMode={inputMode}
        onChange={(e) => onChange(e.target.value)}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className="w-full rounded border border-neutral-300 bg-white px-3 py-2 outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-neutral-700 dark:bg-neutral-900"
      />
      {hint && (
        <p id={`${id}-hint`} className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
          {hint}
        </p>
      )}
    </div>
  );
}

export function SubmitButton({ busy, children }: { busy: boolean; children: ReactNode }) {
  return (
    <button
      type="submit"
      disabled={busy}
      className="w-full rounded bg-indigo-600 px-3 py-2 font-medium text-white outline-none hover:bg-indigo-700 focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:opacity-50 dark:focus-visible:ring-offset-neutral-950"
    >
      {children}
    </button>
  );
}

export function FormMessage({ kind, children }: { kind: "error" | "info"; children: ReactNode }) {
  if (!children) return null;
  return (
    <p
      role={kind === "error" ? "alert" : "status"}
      className={
        kind === "error"
          ? "rounded bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
          : "rounded bg-indigo-50 px-3 py-2 text-sm text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200"
      }
    >
      {children}
    </p>
  );
}

export const linkClass =
  "text-indigo-600 underline-offset-2 hover:underline focus-visible:underline dark:text-indigo-400";
