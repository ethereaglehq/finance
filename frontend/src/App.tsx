import { lazy, Suspense, type ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "./components/Layout";
import { Loading } from "./components/ui";
import { RequireAuth, useAuth } from "./lib/auth";

const Landing = lazy(() => import("./pages/Landing"));
const Login = lazy(() => import("./pages/Auth").then((m) => ({ default: m.Login })));
const Register = lazy(() => import("./pages/Auth").then((m) => ({ default: m.Register })));
const Privacy = lazy(() => import("./pages/Legal").then((m) => ({ default: m.Privacy })));
const Terms = lazy(() => import("./pages/Legal").then((m) => ({ default: m.Terms })));
const NotFound = lazy(() => import("./pages/NotFound"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Onboarding = lazy(() => import("./pages/Onboarding"));
const Portfolio = lazy(() => import("./pages/Portfolio"));
const HoldingDetail = lazy(() => import("./pages/HoldingDetail"));
const Import = lazy(() => import("./pages/Import"));
const Exposure = lazy(() => import("./pages/Exposure"));
const Compare = lazy(() => import("./pages/Compare"));
const Forecast = lazy(() => import("./pages/Forecast"));
const TrackRecord = lazy(() => import("./pages/TrackRecord"));
const Pulse = lazy(() => import("./pages/Pulse"));
const Ask = lazy(() => import("./pages/Ask"));
const Plan = lazy(() => import("./pages/Plan"));
const Learn = lazy(() => import("./pages/Learn"));
const Alerts = lazy(() => import("./pages/Alerts"));
const Settings = lazy(() => import("./pages/Settings"));

function S({ children }: { children: ReactNode }) {
  return <Suspense fallback={<Loading />}>{children}</Suspense>;
}

function GuestOnly({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <Loading />;
  return user ? <Navigate to="/app" replace /> : <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<S><Landing /></S>} />
      <Route path="/login" element={<GuestOnly><S><Login /></S></GuestOnly>} />
      <Route path="/register" element={<S><Register /></S>} />
      <Route path="/privacy" element={<S><Privacy /></S>} />
      <Route path="/terms" element={<S><Terms /></S>} />
      <Route
        path="/app"
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route index element={<S><Dashboard /></S>} />
        <Route path="onboarding" element={<S><Onboarding /></S>} />
        <Route path="portfolio" element={<S><Portfolio /></S>} />
        <Route path="portfolio/:id" element={<S><HoldingDetail /></S>} />
        <Route path="import" element={<S><Import /></S>} />
        <Route path="exposure" element={<S><Exposure /></S>} />
        <Route path="compare" element={<S><Compare /></S>} />
        <Route path="forecast" element={<S><Forecast /></S>} />
        <Route path="track-record" element={<S><TrackRecord /></S>} />
        <Route path="pulse" element={<S><Pulse /></S>} />
        <Route path="ask" element={<S><Ask /></S>} />
        <Route path="plan" element={<S><Plan /></S>} />
        <Route path="learn" element={<S><Learn /></S>} />
        <Route path="alerts" element={<S><Alerts /></S>} />
        <Route path="settings" element={<S><Settings /></S>} />
        <Route path="*" element={<S><NotFound /></S>} />
      </Route>
      <Route path="*" element={<S><NotFound /></S>} />
    </Routes>
  );
}
