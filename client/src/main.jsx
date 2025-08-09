import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { FluentProvider, webLightTheme, webDarkTheme } from '@fluentui/react-components';
import App from './App';
import './index.css';

function Root() {
  const [dark, setDark] = useState(true);
  return (
    <FluentProvider theme={dark ? webDarkTheme : webLightTheme}>
      <App dark={dark} setDark={setDark} />
    </FluentProvider>
  );
}

createRoot(document.getElementById('root')).render(<Root />);
