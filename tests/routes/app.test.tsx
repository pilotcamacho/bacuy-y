import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as auth from "aws-amplify/auth";
import { resetAuthForTests } from "@/hooks/useAuth";
import { openLocalDb } from "@/lib/db";
import { setDbForTests } from "@/lib/db/instance";
import i18n from "@/lib/i18n";
import { routes } from "@/router";

vi.mock("aws-amplify/utils", () => ({ Hub: { listen: vi.fn(() => () => {}) } }));
vi.mock("aws-amplify/auth", () => ({
  getCurrentUser: vi.fn(async () => ({
    userId: "sub-1",
    username: "sub-1",
    signInDetails: { loginId: "ana@example.com" },
  })),
  signOut: vi.fn(async () => {}),
}));
// No network in these tests: every sync call fails like a dropped connection.
vi.mock("@/services/sync/appsyncRemote", async () => {
  const { RemoteError } = await import("@/services/sync/remote");
  const offline = async () => {
    throw new RemoteError("Failed to fetch", "network");
  };
  return { appsyncRemote: { upsert: offline, list: offline } };
});

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

let n = 0;

describe("app shell (signed in)", () => {
  beforeEach(async () => {
    resetAuthForTests();
    setDbForTests(await openLocalDb(`bacuyy-app-${++n}`)); // each test starts with an empty device
  });
  afterEach(async () => {
    await i18n.changeLanguage("es");
  });

  it("renders the page route with navigation in Spanish by default", async () => {
    await i18n.changeLanguage("es");
    renderAt("/");
    expect(await screen.findByRole("heading", { name: "Página" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Navegación principal" })).toBeInTheDocument();
  });

  it("redirects unknown routes to the page", async () => {
    const router = renderAt("/does-not-exist");
    await screen.findByRole("heading", { name: "Página" });
    expect(router.state.location.pathname).toBe("/");
  });

  it("switches language from Settings and persists the override", async () => {
    renderAt("/settings");
    await userEvent.selectOptions(await screen.findByLabelText("Idioma"), "en");
    expect(await screen.findByRole("heading", { name: "Settings" })).toBeInTheDocument();
    expect(localStorage.getItem("bacuyy_locale")).toBe("en");
    expect(document.documentElement.lang).toBe("en");
  });

  it("switches theme from Settings", async () => {
    renderAt("/settings");
    await userEvent.selectOptions(await screen.findByLabelText("Tema"), "dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem("bacuyy_theme")).toBe("dark");
  });

  it("shows the account and, with nothing pending, signs out straight to the sign-in screen", async () => {
    const router = renderAt("/settings");
    expect(await screen.findByText("Sesión iniciada como ana@example.com")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cerrar sesión" }));
    await screen.findByRole("heading", { name: "Iniciar sesión" }, { timeout: 3000 });
    expect(router.state.location.pathname).toBe("/auth/sign-in");
    expect(vi.mocked(auth.signOut)).toHaveBeenCalled();
  });

  it("asks before signing out with changes not uploaded; cancel keeps them, confirm wipes", async () => {
    const { getDb } = await import("@/lib/db/instance");
    const db = await getDb();
    await db.putLocal("Activity", {
      id: "unsynced",
      title: "sin subir",
      rawInput: "sin subir",
      activityType: "ACTION",
      status: "DRAFT",
      position: "a0",
      editedAt: new Date().toISOString(),
    });
    vi.mocked(auth.signOut).mockClear();
    const router = renderAt("/settings");
    await userEvent.click(await screen.findByRole("button", { name: "Cerrar sesión" }));
    const dialog = await screen.findByRole("alertdialog", {}, { timeout: 3000 });
    expect(dialog).toHaveTextContent("Tienes 1 cambio sin subir a la nube");

    await userEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(await db.countDirty()).toBe(1);
    expect(vi.mocked(auth.signOut)).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Cerrar sesión" }));
    await userEvent.click(await screen.findByRole("button", { name: "Cerrar sesión y perderlos" }, { timeout: 3000 }));
    await screen.findByRole("heading", { name: "Iniciar sesión" }, { timeout: 3000 });
    expect(router.state.location.pathname).toBe("/auth/sign-in");
    expect(await db.getAll("Activity")).toEqual([]);
    expect(await db.getMeta("ownerSub")).toBeUndefined();
  });

  it("sends a signed-in user away from the auth screens", async () => {
    const router = renderAt("/auth/sign-up");
    await screen.findByRole("heading", { name: "Página" });
    expect(router.state.location.pathname).toBe("/");
  });
});
