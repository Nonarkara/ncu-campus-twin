import { createRoot } from 'react-dom/client';
import 'maplibre-gl/dist/maplibre-gl.css';
import './styles.css';
import { App } from './App';
import { applyAppearance, initialAppearance } from './shared/appearance';

applyAppearance(initialAppearance());
createRoot(document.getElementById('root')!).render(<App />);
