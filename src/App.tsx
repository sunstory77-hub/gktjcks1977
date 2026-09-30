import { useState } from 'react';
import Home from './components/Home';
import Editor from './components/Editor';
import type { Project } from './core/types';

export default function App() {
  const [project, setProject] = useState<Project | null>(null);
  return project ? (
    <Editor initial={project} onExit={() => setProject(null)} />
  ) : (
    <Home onOpen={setProject} />
  );
}
