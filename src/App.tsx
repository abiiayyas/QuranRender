import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { MainLayout } from './components/layout/MainLayout';
import { Home } from './pages/Home';
import { Editor } from './pages/Editor';
import { Clipper } from './pages/Clipper';
import { Queue } from './pages/Queue';
import { Settings } from './pages/Settings';
import './App.css';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<MainLayout />}>
          <Route index element={<Home />} />
          <Route path="editor" element={<Editor />} />
          <Route path="clipper" element={<Clipper />} />
          <Route path="queue" element={<Queue />} />
          <Route path="settings" element={<Settings />} />
        </Route>
      </Routes>
    </Router>
  );
}

export default App;
