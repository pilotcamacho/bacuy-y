import { Navigate, type RouteObject } from "react-router-dom";
import { Layout } from "@/components/Layout";
import { RedirectIfSignedIn, RequireAuth } from "@/components/RequireAuth";
import { Archived } from "@/routes/Archived";
import { Completed } from "@/routes/Completed";
import { Flags } from "@/routes/Flags";
import { Help } from "@/routes/Help";
import { Expirations } from "@/routes/Expirations";
import { Groceries } from "@/routes/Groceries";
import { Hidden } from "@/routes/Hidden";
import { Journal } from "@/routes/Journal";
import { Page } from "@/routes/Page";
import { PriorityView } from "@/routes/PriorityView";
import { Settings } from "@/routes/Settings";
import { ConfirmSignUp } from "@/routes/auth/ConfirmSignUp";
import { ForgotPassword } from "@/routes/auth/ForgotPassword";
import { SignIn } from "@/routes/auth/SignIn";
import { SignUp } from "@/routes/auth/SignUp";

export const routes: RouteObject[] = [
  {
    element: (
      <RequireAuth>
        <Layout />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <Page /> },
      { path: "priority", element: <PriorityView /> },
      { path: "journal", element: <Journal /> },
      { path: "flags", element: <Flags /> },
      { path: "hidden", element: <Hidden /> },
      { path: "expirations", element: <Expirations /> },
      { path: "groceries", element: <Groceries /> },
      { path: "completed", element: <Completed /> },
      { path: "archived", element: <Archived /> },
      { path: "settings", element: <Settings /> },
      { path: "help", element: <Help /> },
    ],
  },
  {
    path: "auth",
    children: [
      { index: true, element: <Navigate to="sign-in" replace /> },
      { path: "sign-in", element: <RedirectIfSignedIn><SignIn /></RedirectIfSignedIn> },
      { path: "sign-up", element: <RedirectIfSignedIn><SignUp /></RedirectIfSignedIn> },
      { path: "confirm", element: <RedirectIfSignedIn><ConfirmSignUp /></RedirectIfSignedIn> },
      { path: "forgot", element: <RedirectIfSignedIn><ForgotPassword /></RedirectIfSignedIn> },
    ],
  },
  { path: "*", element: <Navigate to="/" replace /> },
];
