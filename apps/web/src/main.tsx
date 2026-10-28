import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { App } from './App';
import { AcceptInvite } from './components/SignIn';
import { AppProvider } from './store';
import './styles.css';

// Both chat routes render the same shell; App reads the chat id from the URL.
const router = createBrowserRouter([
  { path: '/', element: <App />, children: [{ index: true }, { path: 'c/:id' }] },
  { path: '/invite/:token', element: <AcceptInvite /> },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProvider>
      <RouterProvider router={router} />
    </AppProvider>
  </StrictMode>,
);
