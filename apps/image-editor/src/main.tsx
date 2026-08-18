import { createRoot } from 'react-dom/client';
import { ThreeCompositorDemo } from './demo';
import './styles.css';

const root = document.querySelector('#root');
if (!root) {
  throw new Error('React demo root is missing');
}

createRoot(root).render(<ThreeCompositorDemo />);
