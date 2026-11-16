import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { confirmResetPassword, resetPassword } from "aws-amplify/auth";
import {
  AuthForm,
  AuthLayout,
  FormMessage,
  SubmitButton,
  TextField,
  linkClass,
} from "@/components/AuthLayout";
import { authErrorKey } from "@/lib/authErrors";

export function ForgotPassword() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState(params.get("email") ?? "");
  const [step, setStep] = useState<"request" | "confirm">("request");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    setBusy(true);
    const username = email.trim();
    try {
      if (step === "request") {
        await resetPassword({ username });
        setStep("confirm");
      } else {
        await confirmResetPassword({
          username,
          confirmationCode: code.trim(),
          newPassword: password,
        });
        navigate(`/auth/sign-in?email=${encodeURIComponent(username)}&info=passwordChanged`, {
          replace: true,
        });
      }
    } catch (e) {
      setError(t(authErrorKey(e)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title={t("auth.forgot.title")}
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
        {step === "confirm" && (
          <>
            <FormMessage kind="info">{t("auth.forgot.codeSent")}</FormMessage>
            <TextField
              label={t("auth.code")}
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={setCode}
            />
            <TextField
              label={t("auth.newPassword")}
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={setPassword}
              hint={t("auth.passwordHint")}
            />
          </>
        )}
        <FormMessage kind="error">{error}</FormMessage>
        <SubmitButton busy={busy}>
          {step === "request" ? t("auth.forgot.sendCode") : t("auth.forgot.submit")}
        </SubmitButton>
      </AuthForm>
    </AuthLayout>
  );
}
