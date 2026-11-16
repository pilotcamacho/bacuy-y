import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { autoSignIn, confirmSignUp, resendSignUpCode } from "aws-amplify/auth";
import {
  AuthForm,
  AuthLayout,
  FormMessage,
  SubmitButton,
  TextField,
  linkClass,
} from "@/components/AuthLayout";
import { refreshAuth } from "@/hooks/useAuth";
import { authErrorKey } from "@/lib/authErrors";

export function ConfirmSignUp() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState(params.get("email") ?? "");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const signInUrl = `/auth/sign-in?email=${encodeURIComponent(email.trim())}`;

  async function submit() {
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      const { nextStep } = await confirmSignUp({
        username: email.trim(),
        confirmationCode: code.trim(),
      });
      if (nextStep.signUpStep === "COMPLETE_AUTO_SIGN_IN") {
        try {
          await autoSignIn();
          await refreshAuth();
          navigate("/", { replace: true });
          return;
        } catch {
          // auto sign-in only works in the tab that signed up; fall back to the form
        }
      }
      navigate(`${signInUrl}&info=confirmed`, { replace: true });
    } catch (e) {
      setError(t(authErrorKey(e)));
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setError(null);
    try {
      await resendSignUpCode({ username: email.trim() });
      setInfo(t("auth.confirm.resent"));
    } catch (e) {
      setError(t(authErrorKey(e)));
    }
  }

  return (
    <AuthLayout
      title={t("auth.confirm.title")}
      footer={
        <>
          <p>
            <button type="button" className={linkClass} onClick={() => void resend()}>
              {t("auth.confirm.resend")}
            </button>
          </p>
          <p>
            <Link className={linkClass} to={signInUrl}>
              {t("auth.signUp.toSignIn")}
            </Link>
          </p>
        </>
      }
    >
      <AuthForm onSubmit={submit}>
        <p className="text-sm text-neutral-600 dark:text-neutral-300">{t("auth.confirm.help")}</p>
        <TextField
          label={t("auth.email")}
          type="email"
          inputMode="email"
          autoComplete="username"
          value={email}
          onChange={setEmail}
        />
        <TextField
          label={t("auth.code")}
          inputMode="numeric"
          autoComplete="one-time-code"
          value={code}
          onChange={setCode}
        />
        <FormMessage kind="info">{info}</FormMessage>
        <FormMessage kind="error">{error}</FormMessage>
        <SubmitButton busy={busy}>{t("auth.confirm.submit")}</SubmitButton>
      </AuthForm>
    </AuthLayout>
  );
}
