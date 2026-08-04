import React from 'react';
import ReactDOM from 'react-dom/client';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getResources } from '@jarvis/i18n';
import App from './App';
import './styles/globals.css';
import { initRendererState } from './stores/init-store';

void i18n.use(initReactI18next).init({
  resources: getResources(),
  lng: 'zh-CN',
  fallbackLng: 'en',
  ns: ['common'],
  defaultNS: 'common'
});

void initRendererState().finally(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
});
