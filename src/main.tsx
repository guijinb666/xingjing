import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/global.css';

const host = document.getElementById('root');
if (host === null) {
  throw new Error('#root 容器不存在');
}

createRoot(host).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
