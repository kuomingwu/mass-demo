import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { ThemeProvider } from './theme/ThemeProvider';
import { SessionProvider } from './app/SessionContext';
import { NotifyProvider } from './components/Notify';
import { AppRoutes } from './app/routes';
import { I18nProvider } from './i18n';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <I18nProvider>
      <ThemeProvider>
        <SessionProvider>
          <NotifyProvider>
            <HashRouter>
              <AppRoutes />
            </HashRouter>
          </NotifyProvider>
        </SessionProvider>
      </ThemeProvider>
    </I18nProvider>
  </React.StrictMode>,
);
