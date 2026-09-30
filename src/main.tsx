import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
// 폰트를 앱에 포함 (외부 CDN 없이 오프라인에서도 동일하게 렌더링)
import '@fontsource/noto-sans-kr/400.css';
import '@fontsource/noto-sans-kr/700.css';
import '@fontsource/noto-sans-kr/900.css';
import '@fontsource/black-han-sans/400.css';
import '@fontsource/jua/400.css';
import '@fontsource/nanum-myeongjo/400.css';
import '@fontsource/nanum-myeongjo/800.css';
import '@fontsource/gowun-dodum/400.css';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
