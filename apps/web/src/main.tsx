import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { App } from './App';
import { AppProvider } from './store';
import './styles.css';

// Both routes render the same shell; App reads the chat id from the URL.
const router = createBrowserRouter([{ path: '/', element: <App />, children: [{ index: true }, { path: 'c/:id' }] }]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProvider>
      <RouterProvider router={router} />
    </AppProvider>
  </StrictMode>,
);
