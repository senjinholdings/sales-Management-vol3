import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App.js';
import PartnerApp from './PartnerApp.js';
import reportWebVitals from './reportWebVitals.js';

// エントリーポイントをURLパラメータまたは環境変数で切り替え
const isPartner = window.location.pathname.startsWith('/partner') || 
                  window.location.pathname.startsWith('/partner-entry') ||
                  window.location.search.includes('app=partner') ||
                  process.env.REACT_APP_ENTRY_POINT === 'partner';
const AppComponent = isPartner ? PartnerApp : App;

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <AppComponent />
  </React.StrictMode>
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
