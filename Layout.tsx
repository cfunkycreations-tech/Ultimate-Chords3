import React, { useState } from "react";
import { Link, Outlet, useNavigate } from "react-router-dom";
import { Search, Guitar, Menu, Mic } from "lucide-react";

export function Layout() {
  const [searchQuery, setSearchQuery] = useState("");
  const navigate = useNavigate();

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      navigate(`/search?q=${encodeURIComponent(searchQuery.trim())}`);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-50 font-sans selection:bg-yellow-500/30">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-zinc-900/80 backdrop-blur-md border-b border-zinc-800">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <button className="p-2 -ml-2 hover:bg-zinc-800 rounded-full md:hidden">
              <Menu className="w-5 h-5" />
            </button>
            <Link to="/" className="flex items-center gap-2 text-yellow-500 font-bold text-xl tracking-tight">
              <Guitar className="w-6 h-6" />
              <span className="hidden sm:inline">Ultimate Chords</span>
            </Link>
          </div>

          <form onSubmit={handleSearch} className="flex-1 max-w-xl relative hidden md:block">
            <div className="relative flex items-center w-full">
              <Search className="absolute left-3 w-4 h-4 text-zinc-400" />
              <input
                type="text"
                placeholder="Search for songs, artists..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-zinc-800/50 border border-zinc-700 rounded-full py-2 pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500/50 focus:border-yellow-500 transition-all placeholder:text-zinc-500"
              />
            </div>
          </form>

          <div className="flex items-center gap-2">
            <Link to="/tuner" className="flex items-center gap-2 px-4 py-2 text-sm font-medium hover:bg-zinc-800 rounded-full transition-colors text-zinc-300 hover:text-yellow-500">
              <Mic className="w-4 h-4" />
              <span className="hidden sm:inline">Tuner</span>
            </Link>
            <button className="hidden sm:block px-4 py-2 text-sm font-medium hover:bg-zinc-800 rounded-full transition-colors">
              Log in
            </button>
            <button className="px-4 py-2 text-sm font-medium bg-yellow-500 text-zinc-950 hover:bg-yellow-400 rounded-full transition-colors">
              Sign up
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
