import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ToastProvider } from './components/Toast';
import { queryClient } from './query';
import { router } from './router';
import { applyRoot } from './settings';
import { takeFragment } from './hubs';
import './styles/tokens.css';
import './styles/themes.css';
import './styles/motion.css';
import './styles/shell.css';
import './styles/pages.css';

applyRoot();
takeFragment();
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
