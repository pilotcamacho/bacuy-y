import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { signUp } from "aws-amplify/auth";
import {
  AuthForm,
  AuthLayout,
  FormMessage,
  SubmitButton,
  TextField,
  linkClass,
} from "@/components/AuthLayout";
import { authErrorKey } from "@/lib/authErrors";

export function SignUp() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    setBusy(true);
    const username = email.trim();
    try {
      const { nextStep } = await signUp({
        username,
        password,
        options: { userAttributes: { email: username }, autoSignIn: true },
      });
      if (nextStep.signUpStep === "CONFIRM_SIGN_UP") {
        navigate(`/auth/confirm?email=${encodeURIComponent(username)}`);
      } else {
        navigate(`/auth/sign-in?email=${encodeURIComponent(username)}`);
      }
    } catch (e) {
      setError(t(authErrorKey(e)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title={t("auth.signUp.title")}
      footer={
        <p>
          <Link className={linkClass} to="/auth/sign-in">
            {t("auth.signUp.toSignIn")}
          </Link>
        </p>
      }
    >
      <AuthForm onSubmit={submit}>
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
          autoComplete="new-password"
          value={password}
          onChange={setPassword}
          hint={t("auth.passwordHint")}
        />
        <FormMessage kind="error">{error}</FormMessage>
        <SubmitButton busy={busy}>{t("auth.signUp.submit")}</SubmitButton>
      </AuthForm>
    </AuthLayout>
  );
}
