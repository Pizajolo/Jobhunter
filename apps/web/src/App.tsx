import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { createBrowserRouter, Navigate, RouterProvider, useLocation } from 'react-router';
import { Layout } from './components/Layout';
import { Spinner } from './components/ui';
import { useSettings } from './lib/settings';
import { useLiveUpdates } from './lib/live';
import { setUiLanguage } from './i18n';

const Pipeline = lazy(() => import('./routes/Pipeline'));
const JobDetail = lazy(() => import('./routes/JobDetail'));
const Approvals = lazy(() => import('./routes/Approvals'));
const ReviewQueue = lazy(() => import('./routes/ReviewQueue'));
const Inbox = lazy(() => import('./routes/Inbox'));
const Stats = lazy(() => import('./routes/Stats'));
const Profile = lazy(() => import('./routes/Profile'));
const SettingsPage = lazy(() => import('./routes/Settings'));
const Diagnostics = lazy(() => import('./routes/Diagnostics'));
const Onboarding = lazy(() => import('./routes/Onboarding'));
const Login = lazy(() => import('./routes/Login'));

function Loading() {
  return (
    <div className="flex items-center gap-2 p-6 text-ink-3" role="status">
      <Spinner /> <span className="sr-only">Loading</span>
    </div>
  );
}

/** Sends first-time users to onboarding and keeps the UI language in sync with settings. */
function Guard({ children }: { children: ReactNode }) {
  const settings = useSettings();
  const location = useLocation();
  useLiveUpdates();
  useEffect(() => {
    if (settings.data?.language) setUiLanguage(settings.data.language);
  }, [settings.data?.language]);
  if (settings.isPending) return <Loading />;
  if (settings.data && !settings.data.onboardingCompleted && location.pathname !== '/onboarding') {
    return <Navigate to="/onboarding" replace />;
  }
  return <>{children}</>;
}

const s = (el: ReactNode) => <Suspense fallback={<Loading />}>{el}</Suspense>;

const router = createBrowserRouter([
  { path: '/login', element: s(<Login />) },
  {
    path: '/onboarding',
    element: <Guard>{s(<Onboarding />)}</Guard>,
  },
  {
    element: (
      <Guard>
        <Layout />
      </Guard>
    ),
    children: [
      { path: '/', element: s(<Pipeline />) },
      { path: '/jobs/:id', element: s(<JobDetail />) },
      { path: '/approvals', element: s(<Approvals />) },
      { path: '/review', element: s(<ReviewQueue />) },
      { path: '/inbox', element: s(<Inbox />) },
      { path: '/stats', element: s(<Stats />) },
      { path: '/profile', element: s(<Profile />) },
      { path: '/settings', element: s(<SettingsPage />) },
      { path: '/diagnostics', element: s(<Diagnostics />) },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
