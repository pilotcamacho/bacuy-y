import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as auth from "aws-amplify/auth";
import { resetAuthForTests } from "@/hooks/useAuth";
import i18n from "@/lib/i18n";
import { routes } from "@/router";

vi.mock("aws-amplify/utils", () => ({ Hub: { listen: vi.fn(() => () => {}) } }));
vi.mock("aws-amplify/auth", () => ({
  getCurrentUser: vi.fn(),
  signIn: vi.fn(),
  signUp: vi.fn(),
  confirmSignUp: vi.fn(),
  autoSignIn: vi.fn(),
  resendSignUpCode: vi.fn(),
  resetPassword: vi.fn(),
  confirmResetPassword: vi.fn(),
  signOut: vi.fn(),
}));

const m = vi.mocked(auth);
const USER = { userId: "sub-1", username: "sub-1", signInDetails: { loginId: "ana@example.com" } };

function named(name: string) {
  return Object.assign(new Error(name), { name });
}

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

describe("auth screens", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("es"); // jsdom's navigator language is en-US
    vi.resetAllMocks();
    resetAuthForTests();
    m.getCurrentUser.mockRejectedValue(named("UserUnAuthenticatedException"));
  });

  it("guards the page: signed out → sign-in screen", async () => {
    const router = renderAt("/");
    await screen.findByRole("heading", { name: "Iniciar sesión" });
    expect(router.state.location.pathname).toBe("/auth/sign-in");
  });

  it("signs in and goes back to the page it came from", async () => {
    const router = renderAt("/settings");
    await screen.findByRole("heading", { name: "Iniciar sesión" });
    m.signIn.mockResolvedValue({ isSignedIn: true, nextStep: { signInStep: "DONE" } });
    m.getCurrentUser.mockResolvedValue(USER as never);
    await userEvent.type(screen.getByLabelText("Correo electrónico"), " ana@example.com ");
    await userEvent.type(screen.getByLabelText("Contraseña"), "Secret-123");
    await userEvent.click(screen.getByRole("button", { name: "Entrar" }));
    await screen.findByRole("heading", { name: "Ajustes" });
    expect(m.signIn).toHaveBeenCalledWith({ username: "ana@example.com", password: "Secret-123" });
    expect(router.state.location.pathname).toBe("/settings");
  });

  it("shows a translated error for wrong credentials", async () => {
    renderAt("/auth/sign-in");
    m.signIn.mockRejectedValue(named("NotAuthorizedException"));
    await userEvent.type(await screen.findByLabelText("Correo electrónico"), "ana@example.com");
    await userEvent.type(screen.getByLabelText("Contraseña"), "nope");
    await userEvent.click(screen.getByRole("button", { name: "Entrar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Correo o contraseña incorrectos.");
  });

  it("signs up, then confirms the code and auto signs in", async () => {
    const router = renderAt("/auth/sign-up");
    m.signUp.mockResolvedValue({
      isSignUpComplete: false,
      nextStep: { signUpStep: "CONFIRM_SIGN_UP" },
    } as never);
    await userEvent.type(await screen.findByLabelText("Correo electrónico"), "ana@example.com");
    await userEvent.type(screen.getByLabelText("Contraseña"), "Secret-123!");
    await userEvent.click(screen.getByRole("button", { name: "Crear cuenta" }));
    expect(m.signUp).toHaveBeenCalledWith({
      username: "ana@example.com",
      password: "Secret-123!",
      options: { userAttributes: { email: "ana@example.com" }, autoSignIn: true },
    });

    await screen.findByRole("heading", { name: "Confirmar correo" });
    expect(screen.getByLabelText("Correo electrónico")).toHaveValue("ana@example.com");
    m.confirmSignUp.mockResolvedValue({
      isSignUpComplete: true,
      nextStep: { signUpStep: "COMPLETE_AUTO_SIGN_IN" },
    } as never);
    m.autoSignIn.mockResolvedValue({ isSignedIn: true, nextStep: { signInStep: "DONE" } });
    m.getCurrentUser.mockResolvedValue(USER as never);
    await userEvent.type(screen.getByLabelText("Código de verificación"), "123456");
    await userEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await screen.findByRole("heading", { name: "Página" });
    expect(m.confirmSignUp).toHaveBeenCalledWith({
      username: "ana@example.com",
      confirmationCode: "123456",
    });
    expect(router.state.location.pathname).toBe("/");
  });

  it("resets the password in two steps", async () => {
    const router = renderAt("/auth/forgot?email=ana%40example.com");
    m.resetPassword.mockResolvedValue({} as never);
    await userEvent.click(await screen.findByRole("button", { name: "Enviar código" }));
    expect(m.resetPassword).toHaveBeenCalledWith({ username: "ana@example.com" });
    m.confirmResetPassword.mockResolvedValue();
    await userEvent.type(await screen.findByLabelText("Código de verificación"), "654321");
    await userEvent.type(screen.getByLabelText("Contraseña nueva"), "New-Secret-1");
    await userEvent.click(screen.getByRole("button", { name: "Cambiar contraseña" }));
    expect(await screen.findByText("Contraseña cambiada. Inicia sesión con la nueva.")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/auth/sign-in");
  });

  it("offline with a remembered user: the app opens without the network", async () => {
    localStorage.setItem(
      "bacuyy_lastUser",
      JSON.stringify({ userId: "sub-1", username: "sub-1", email: "ana@example.com" }),
    );
    m.getCurrentUser.mockRejectedValue(named("NetworkError"));
    renderAt("/");
    expect(await screen.findByRole("heading", { name: "Página" })).toBeInTheDocument();
  });
});
