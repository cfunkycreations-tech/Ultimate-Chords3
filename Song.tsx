import { useEffect, useState, useRef } from "react";
import { useParams } from "react-router-dom";
import { fetchSongChords } from "../services/gemini";
import { parseChordPro, extractOriginalCapo } from "../lib/chordPro";
import { Loader2, Minus, Plus, Play, Pause, Settings2 } from "lucide-react";
import { cn } from "../lib/utils";
import { ProTabPlayer } from "../components/ProTabPlayer";
import { StaticTabViewer } from "../components/StaticTabViewer";

export function Song() {
  const { artist, title } = useParams<{ artist: string, title: string }>();
  const [rawText, setRawText] = useState("");
  const [cache, setCache] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [format, setFormat] = useState<'chords' | 'tabs' | 'pro'>('chords');
  
  const [transpose, setTranspose] = useState(0);
  const [capo, setCapo] = useState(0);
  const [originalCapo, setOriginalCapo] = useState(0);
  const [songCapoExtracted, setSongCapoExtracted] = useState<string>("");
  const [fontSize, setFontSize] = useState(16);
  const [autoScroll, setAutoScroll] = useState(false);
  const [scrollSpeed, setScrollSpeed] = useState(0.5);
  
  const scrollRef = useRef<number>(null);
  const exactScrollY = useRef<number>(0);

  const dataType = format === 'chords' ? 'chords' : 'tabs';

  useEffect(() => {
    if (!artist || !title) return;
    
    const songKey = `${artist}-${title}`;
    const cacheKey = `${songKey}-${dataType}`;
    
    // Use cached data if available
    if (cache[cacheKey]) {
      setRawText(cache[cacheKey]);
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);
    fetchSongChords(title, artist, dataType).then(text => {
      if (active) {
        setRawText(text);
        setCache(prev => ({ ...prev, [cacheKey]: text }));
        setLoading(false);
      }
    }).catch(err => {
      if (active) {
        console.error("Failed to fetch song:", err);
        setRawText(`Error: Could not load song. You might be offline and this song is not cached.\n\n[comment: Error]\nPlease check your internet connection and try again.`);
        setLoading(false);
      }
    });

    return () => { active = false; };
  }, [artist, title, dataType, cache]);

  // Extract capo when chords are loaded for a new song
  useEffect(() => {
    const songKey = `${artist}-${title}`;
    if (dataType === 'chords' && rawText && songCapoExtracted !== songKey) {
      const extractedCapo = extractOriginalCapo(rawText);
      setOriginalCapo(extractedCapo);
      setCapo(extractedCapo);
      setTranspose(0); // Reset transpose for new song
      setSongCapoExtracted(songKey);
    }
  }, [rawText, dataType, artist, title, songCapoExtracted]);

  useEffect(() => {
    if (autoScroll) {
      exactScrollY.current = window.scrollY;
      const scroll = () => {
        exactScrollY.current += scrollSpeed;
        window.scrollTo(0, exactScrollY.current);
        scrollRef.current = requestAnimationFrame(scroll);
      };
      scrollRef.current = requestAnimationFrame(scroll);
    } else if (scrollRef.current) {
      cancelAnimationFrame(scrollRef.current);
    }
    return () => {
      if (scrollRef.current) cancelAnimationFrame(scrollRef.current);
    };
  }, [autoScroll, scrollSpeed]);

  const parsedLines = parseChordPro(rawText, transpose - (capo - originalCapo));

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-32 space-y-4">
        <Loader2 className="w-12 h-12 animate-spin text-yellow-500" />
        <p className="text-zinc-400">Generating {format} for {title}...</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8 pb-32">
      {/* Header */}
      {format === 'chords' && (
        <div className="space-y-2">
          <h1 className="text-4xl font-bold tracking-tight">{title}</h1>
          <p className="text-xl text-zinc-400">by <span className="text-zinc-200 font-medium">{artist}</span></p>
        </div>
      )}

      {/* Controls */}
      <div className="sticky top-20 z-40 bg-zinc-900/95 backdrop-blur border border-zinc-800 rounded-2xl p-4 flex flex-wrap items-center gap-6 shadow-xl">
        
        {/* Format Toggle */}
        <div className="flex bg-zinc-950 rounded-lg border border-zinc-800 p-1">
          <button
            onClick={() => setFormat('chords')}
            className={cn(
              "px-4 py-1.5 rounded-md text-sm font-medium transition-colors",
              format === 'chords' ? "bg-zinc-800 text-yellow-500" : "text-zinc-400 hover:text-zinc-200"
            )}
          >
            Chords
          </button>
          <button
            onClick={() => setFormat('tabs')}
            className={cn(
              "px-4 py-1.5 rounded-md text-sm font-medium transition-colors",
              format === 'tabs' ? "bg-zinc-800 text-yellow-500" : "text-zinc-400 hover:text-zinc-200"
            )}
          >
            Tabs
          </button>
          <button
            onClick={() => setFormat('pro')}
            className={cn(
              "px-4 py-1.5 rounded-md text-sm font-medium transition-colors",
              format === 'pro' ? "bg-zinc-800 text-yellow-500" : "text-zinc-400 hover:text-zinc-200"
            )}
          >
            Pro Tabs
          </button>
        </div>

        {/* Transpose (only for chords) */}
        {format === 'chords' && (
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-zinc-400">Transpose</span>
            <div className="flex items-center bg-zinc-950 rounded-lg border border-zinc-800">
              <button 
                onClick={() => setTranspose(t => t - 1)}
                className="p-2 hover:text-yellow-500 hover:bg-zinc-800 rounded-l-lg transition-colors"
              >
                <Minus className="w-4 h-4" />
              </button>
              <span className="w-12 text-center font-mono font-medium">
                {transpose > 0 ? `+${transpose}` : transpose}
              </span>
              <button 
                onClick={() => setTranspose(t => t + 1)}
                className="p-2 hover:text-yellow-500 hover:bg-zinc-800 rounded-r-lg transition-colors"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Capo (only for chords) */}
        {format === 'chords' && (
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-zinc-400">Capo</span>
            <div className="flex items-center bg-zinc-950 rounded-lg border border-zinc-800">
              <button 
                onClick={() => setCapo(c => Math.max(0, c - 1))}
                className="p-2 hover:text-yellow-500 hover:bg-zinc-800 rounded-l-lg transition-colors"
              >
                <Minus className="w-4 h-4" />
              </button>
              <span className="w-16 text-center font-mono font-medium text-sm">
                {capo > 0 ? `Fret ${capo}` : 'None'}
              </span>
              <button 
                onClick={() => setCapo(c => Math.min(12, c + 1))}
                className="p-2 hover:text-yellow-500 hover:bg-zinc-800 rounded-r-lg transition-colors"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Font Size */}
        {(format === 'chords' || format === 'tabs') && (
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-zinc-400">Font Size</span>
            <div className="flex items-center bg-zinc-950 rounded-lg border border-zinc-800">
              <button 
                onClick={() => setFontSize(s => Math.max(10, s - 2))}
                className="p-2 hover:text-yellow-500 hover:bg-zinc-800 rounded-l-lg transition-colors"
              >
                <Minus className="w-4 h-4" />
              </button>
              <span className="w-12 text-center font-mono font-medium">{fontSize}</span>
              <button 
                onClick={() => setFontSize(s => Math.min(32, s + 2))}
                className="p-2 hover:text-yellow-500 hover:bg-zinc-800 rounded-r-lg transition-colors"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {(format === 'chords' || format === 'tabs') && <div className="w-px h-8 bg-zinc-800 hidden sm:block"></div>}

        {/* Auto Scroll */}
        <div className="flex items-center gap-3 ml-auto">
          <button
            onClick={() => setAutoScroll(!autoScroll)}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors border",
              autoScroll 
                ? "bg-yellow-500 text-zinc-950 border-yellow-500 hover:bg-yellow-400" 
                : "bg-zinc-950 text-zinc-300 border-zinc-800 hover:border-zinc-700"
            )}
          >
            {autoScroll ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            Auto Scroll
          </button>
          
          {autoScroll && (
            <div className="flex items-center gap-2 bg-zinc-950 rounded-lg border border-zinc-800 px-3 py-2">
              <Settings2 className="w-4 h-4 text-zinc-500" />
              <input 
                type="range" 
                min="0.1" max="2" step="0.1" 
                value={scrollSpeed}
                onChange={(e) => setScrollSpeed(parseFloat(e.target.value))}
                className="w-24 accent-yellow-500"
              />
            </div>
          )}
        </div>
      </div>

      {format === 'pro' ? (
        <ProTabPlayer rawText={rawText} title={title || ''} artist={artist || ''} />
      ) : format === 'tabs' ? (
        <StaticTabViewer rawText={rawText} fontSize={fontSize} />
      ) : (
        <div 
          className="font-mono bg-zinc-950 border border-zinc-800 rounded-2xl p-6 sm:p-10 overflow-x-auto shadow-inner"
          style={{ fontSize: `${fontSize}px`, lineHeight: 1.8 }}
        >
          {parsedLines.map((line, i) => {
            if (line.type === 'empty') {
              return <div key={i} className="h-[1em]" />;
            }
            
            if (line.type === 'directive') {
              return (
                <div key={i} className="text-zinc-500 italic mt-6 mb-2 font-sans font-medium text-sm uppercase tracking-wider">
                  [{line.content}]
                </div>
              );
            }

            if (line.type === 'tab') {
              return <div key={i} className="text-zinc-300 whitespace-pre">{line.content}</div>;
            }

            if (line.type === 'lyric') {
              return <div key={i} className="text-zinc-300 whitespace-pre">{line.content}</div>;
            }

            if (line.type === 'chord') {
              return (
                <div key={i} className="flex flex-wrap items-end relative mt-6">
                  {line.segments?.map((seg, j) => (
                    <div key={j} className="relative inline-flex flex-col justify-end">
                      {seg.chord && (
                        <span className="absolute bottom-full left-0 text-yellow-500 font-bold leading-none mb-1 whitespace-pre">
                          {seg.chord}
                        </span>
                      )}
                      <span className="text-zinc-300 whitespace-pre">
                        {seg.lyric || (seg.chord ? ' '.repeat(seg.chord.length + 1) : '')}
                      </span>
                    </div>
                  ))}
                </div>
              );
            }

            return null;
          })}
        </div>
      )}
    </div>
  );
}
