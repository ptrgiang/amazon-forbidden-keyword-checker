import React from 'react';
import { createRoot } from 'react-dom/client';
import '../ui/ui.css';
import { PopupApp } from './PopupApp';

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <React.StrictMode>
      <PopupApp />
    </React.StrictMode>
  );
}
