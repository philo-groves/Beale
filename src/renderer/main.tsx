import React, { lazy, Suspense, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { InitialAppShell } from './app/InitialAppShell';
import './startup.css';

const App = lazy(() => import('./App').then((module) => ({ default: module.App })));

function RendererRoot(): React.JSX.Element {
  const [workbenchReady, setWorkbenchReady] = useState(false);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setWorkbenchReady(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);
  if (!workbenchReady) return <InitialAppShell />;
  return (
    <Suspense fallback={<InitialAppShell />}>
      <App />
    </Suspense>
  );
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <RendererRoot />
  </React.StrictMode>
);
