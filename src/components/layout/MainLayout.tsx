import React, { useEffect } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { Home, Settings, ListVideo, PlaySquare, Scissors, Menu } from 'lucide-react';
import { listen } from '@tauri-apps/api/event';
import { useAppStore } from '../../store';
import { Button } from '../ui/button';
import { Sheet, SheetContent, SheetTrigger } from '../ui/sheet';

export const MainLayout: React.FC = () => {
  const updateRenderJob = useAppStore(state => state.updateRenderJob);
  const theme = useAppStore(state => state.settings.theme);
  const location = useLocation();

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  useEffect(() => {
    const unlisten = listen('render-status', (event: any) => {
      console.log('Render Status Update:', event.payload);
      updateRenderJob(event.payload);
    });

    return () => {
      unlisten.then(f => f());
    };
  }, [updateRenderJob]);

  const NavLinks = () => (
    <div className="flex items-center space-x-1 lg:space-x-2 text-sm font-medium">
      <Link to="/" className={`flex items-center gap-2 rounded-md px-3 py-2 transition-colors hover:bg-muted ${location.pathname === '/' ? 'bg-muted text-foreground' : 'text-muted-foreground'}`}>
        <Home size={16} /> <span className="hidden sm:inline">Home</span>
      </Link>
      <Link to="/editor" className={`flex items-center gap-2 rounded-md px-3 py-2 transition-colors hover:bg-muted ${location.pathname === '/editor' ? 'bg-muted text-foreground' : 'text-muted-foreground'}`}>
        <PlaySquare size={16} /> <span className="hidden sm:inline">Editor</span>
      </Link>
      <Link to="/clipper" className={`flex items-center gap-2 rounded-md px-3 py-2 transition-colors hover:bg-muted ${location.pathname === '/clipper' ? 'bg-muted text-foreground' : 'text-muted-foreground'}`}>
        <Scissors size={16} /> <span className="hidden sm:inline">Clipper</span>
      </Link>
      <Link to="/queue" className={`flex items-center gap-2 rounded-md px-3 py-2 transition-colors hover:bg-muted ${location.pathname === '/queue' ? 'bg-muted text-foreground' : 'text-muted-foreground'}`}>
        <ListVideo size={16} /> <span className="hidden sm:inline">Render Queue</span>
      </Link>
      <Link to="/settings" className={`flex items-center gap-2 rounded-md px-3 py-2 transition-colors hover:bg-muted ${location.pathname === '/settings' ? 'bg-muted text-foreground' : 'text-muted-foreground'}`}>
        <Settings size={16} /> <span className="hidden sm:inline">Settings</span>
      </Link>
    </div>
  );

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto flex h-14 items-center justify-between px-4">
          <Link to="/" className="flex items-center space-x-2">
            <span className="font-bold sm:inline-block">Quran Render</span>
          </Link>
          
          <div className="flex items-center gap-4">
            <div className="hidden md:flex">
              <NavLinks />
            </div>
            
            <Sheet>
            <SheetTrigger render={<Button variant="ghost" size="icon" className="md:hidden" />}>
              <Menu className="h-5 w-5" />
              <span className="sr-only">Toggle Menu</span>
            </SheetTrigger>
            <SheetContent side="left" className="pr-0">
              <Link to="/" className="flex items-center space-x-2 mb-6">
                <span className="font-bold text-lg">Quran Render</span>
              </Link>
              <div className="flex flex-col gap-2">
                <Link to="/" className={`flex items-center gap-2 rounded-md px-3 py-2 transition-colors hover:bg-muted ${location.pathname === '/' ? 'bg-muted text-foreground font-medium' : 'text-muted-foreground'}`}>
                  <Home size={18} /> Home
                </Link>
                <Link to="/editor" className={`flex items-center gap-2 rounded-md px-3 py-2 transition-colors hover:bg-muted ${location.pathname === '/editor' ? 'bg-muted text-foreground font-medium' : 'text-muted-foreground'}`}>
                  <PlaySquare size={18} /> Editor
                </Link>
                <Link to="/clipper" className={`flex items-center gap-2 rounded-md px-3 py-2 transition-colors hover:bg-muted ${location.pathname === '/clipper' ? 'bg-muted text-foreground font-medium' : 'text-muted-foreground'}`}>
                  <Scissors size={18} /> Clipper
                </Link>
                <Link to="/queue" className={`flex items-center gap-2 rounded-md px-3 py-2 transition-colors hover:bg-muted ${location.pathname === '/queue' ? 'bg-muted text-foreground font-medium' : 'text-muted-foreground'}`}>
                  <ListVideo size={18} /> Render Queue
                </Link>
                <Link to="/settings" className={`flex items-center gap-2 rounded-md px-3 py-2 transition-colors hover:bg-muted ${location.pathname === '/settings' ? 'bg-muted text-foreground font-medium' : 'text-muted-foreground'}`}>
                  <Settings size={18} /> Settings
                </Link>
              </div>
            </SheetContent>
          </Sheet>
          </div>
        </div>
      </header>
      
      <main className="flex-1 flex flex-col w-full h-[calc(100vh-3.5rem)]">
        <Outlet />
      </main>
    </div>
  );
};
