import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { signIn } from "aws-amplify/auth";
import {
  AuthForm,
  AuthLayout,
  FormMessage,
  SubmitButton,
  TextField,
  linkClass,
} from "@/components/AuthLayout";
import { refreshAuth } from "@/hooks/useAuth";
import { useOnline } from "@/hooks/useOnline";
import { authErrorKey } from "@/lib/authErrors";

export function SignIn() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const online = useOnline();
  const [email, setEmail] = useState(params.get("email") ?? "");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const info = params.get("info");
  const returnTo = (location.state as { from?: string } | null)?.from ?? "/";

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      const { nextStep } = await signIn({ username: email.trim(), password });
      if (nextStep.signInStep === "CONFIRM_SIGN_UP") {
        navigate(`/auth/confirm?email=${encodeURIComponent(email.trim())}`);
        return;
      }
      if (nextStep.signInStep !== "DONE") {
        setError(t("auth.errors.generic"));
        return;
      }
      await refreshAuth();
      navigate(returnTo, { replace: true });
    } catch (e) {
      setError(t(authErrorKey(e)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title={t("auth.signIn.title")}
      footer={
        <>
          <p>
            <Link className={linkClass} to="/auth/sign-up">
              {t("auth.signIn.toSignUp")}
            </Link>
          </p>
          <p>
            <Link className={linkClass} to={`/auth/forgot?email=${encodeURIComponent(email)}`}>
              {t("auth.signIn.forgot")}
            </Link>
          </p>
        </>
      }
    >
      <AuthForm onSubmit={submit}>
        {!online && <FormMessage kind="info">{t("auth.offlineFirstSignIn")}</FormMessage>}
        {info && <FormMessage kind="info">{t(`auth.info.${info}`)}</FormMessage>}
        <TextField
          label={t("auth.email")}
          type="email"
          inputMode="email"
          autoComplete="username"
          value={email}
          onChange={setEmail}
        />
        <TextField
          label={t("auth.password")}
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={setPassword}
        />
        <FormMessage kind="error">{error}</FormMessage>
        <SubmitButton busy={busy}>{t("auth.signIn.submit")}</SubmitButton>
      </AuthForm>
    </AuthLayout>
  );
}
