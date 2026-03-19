import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Play, Pause, SkipBack, Repeat, Guitar, Sparkles, SlidersHorizontal, CheckCircle2, Volume2, Loader2 } from 'lucide-react';
// @ts-ignore
import Soundfont from 'soundfont-player';
import { parseGuitarTab } from '../lib/tabParser';
import { cn } from '../lib/utils';

function getBaseMidiNote(prefix: string, stringIdx: number, totalStrings: number): number {
  const p = prefix.replace(/[^a-zA-Z#]/g, '');
  const standard6 = [64, 59, 55, 50, 45, 40]; // e, B, G, D, A, E
  const standard4 = [43, 38, 33, 28]; // G, D, A, E
  const standard = totalStrings === 4 ? standard4 : standard6;
  
  if (!p) return standard[stringIdx] || 40;
  
  if (p === 'e') return 64;
  if (p === 'E') return 40;
  
  const noteMap: Record<string, number> = {
    'b': 59, 'g': 55, 'd': 50, 'a': 45,
    'e#': 65, 'b#': 60, 'g#': 56, 'd#': 51, 'a#': 46,
    'eb': 63, 'bb': 58, 'gb': 54, 'db': 49, 'ab': 44,
    'f': 65, 'c': 60, 'f#': 66, 'c#': 61,
  };
  
  const lowerP = p.toLowerCase();
  if (noteMap[lowerP]) {
     let midi = noteMap[lowerP];
     if (stringIdx >= 3 && midi > 50) midi -= 24;
     else if (stringIdx >= 3 && midi > 40) midi -= 12;
     return midi;
  }
  
  return standard[stringIdx] || 40;
}

interface ProTabPlayerProps {
  rawText: string;
  title: string;
  artist: string;
}

export function ProTabPlayer({ rawText, title, artist }: ProTabPlayerProps) {
  const parsedTabs = useMemo(() => parseGuitarTab(rawText), [rawText]);
  
  const [playing, setPlaying] = useState(false);
  const [playheadIndex, setPlayheadIndex] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [volume, setVolume] = useState(0.5);
  const [instrument, setInstrument] = useState<any>(null);
  const [isLoadingAudio, setIsLoadingAudio] = useState(false);
  
  const containerRef = useRef<HTMLDivElement>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const instrumentBusRef = useRef<GainNode | null>(null);

  const initAudio = async () => {
    if (!audioCtxRef.current) {
      setIsLoadingAudio(true);
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioCtxRef.current = ctx;
      
      const masterGain = ctx.createGain();
      masterGain.gain.value = volume;
      masterGain.connect(ctx.destination);
      masterGainRef.current = masterGain;

      const instrumentBus = ctx.createGain();
      instrumentBus.connect(masterGain);
      instrumentBusRef.current = instrumentBus;

      // Add Subtle Delay/Room Effect
      const delay = ctx.createDelay();
      delay.delayTime.value = 0.2; // 200ms delay

      const feedback = ctx.createGain();
      feedback.gain.value = 0.25; // 25% feedback

      const delayFilter = ctx.createBiquadFilter();
      delayFilter.type = 'lowpass';
      delayFilter.frequency.value = 2000; // Darken the echoes

      delay.connect(feedback);
      feedback.connect(delayFilter);
      delayFilter.connect(delay);

      delay.connect(masterGain);
      instrumentBus.connect(delay); // Send instrument to delay

      try {
        const inst = await Soundfont.instrument(ctx, 'acoustic_guitar_steel', {
          destination: instrumentBus
        });
        setInstrument(inst);
      } catch (err) {
        console.error('Failed to load soundfont:', err);
      } finally {
        setIsLoadingAudio(false);
      }
    }
    if (audioCtxRef.current?.state === 'suspended') {
      audioCtxRef.current.resume();
    }
  };

  useEffect(() => {
    if (masterGainRef.current) {
      masterGainRef.current.gain.value = volume;
    }
  }, [volume]);

  const playNote = (midiNote: number) => {
    if (instrument && audioCtxRef.current) {
      instrument.play(midiNote, audioCtxRef.current.currentTime, { duration: 3.5 });
      return;
    }
    
    // Fallback to basic synth if soundfont isn't loaded yet
    if (!audioCtxRef.current || !instrumentBusRef.current) return;
    const ctx = audioCtxRef.current;
    const freq = 440 * Math.pow(2, (midiNote - 69) / 12);
    
    // Oscillator 1: Triangle (warm body of the sound)
    const osc1 = ctx.createOscillator();
    osc1.type = 'triangle';
    
    // Oscillator 2: Square (woody/metallic pluck)
    const osc2 = ctx.createOscillator();
    osc2.type = 'square';
    osc2.detune.value = 4; // Slight detune for thickness/chorus effect
    
    // Filter for the pluck (starts bright, quickly gets duller)
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(freq * 8, ctx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(freq * 1.5, ctx.currentTime + 0.15);
    filter.frequency.linearRampToValueAtTime(freq, ctx.currentTime + 3.0);
    
    // Note Gain (ADSR Envelope)
    const noteGain = ctx.createGain();
    noteGain.gain.setValueAtTime(0, ctx.currentTime);
    // Attack
    noteGain.gain.linearRampToValueAtTime(0.8, ctx.currentTime + 0.015); 
    // Decay to Sustain
    noteGain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.3); 
    // Release
    noteGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 3.5); 
    
    // Balance the oscillators
    const osc1Gain = ctx.createGain();
    osc1Gain.gain.value = 0.7;
    const osc2Gain = ctx.createGain();
    osc2Gain.gain.value = 0.3;

    osc1.connect(osc1Gain);
    osc2.connect(osc2Gain);

    osc1Gain.connect(noteGain);
    osc2Gain.connect(filter);
    filter.connect(noteGain);
    
    noteGain.connect(instrumentBusRef.current);
    
    osc1.start();
    osc2.start();
    osc1.stop(ctx.currentTime + 3.5);
    osc2.stop(ctx.currentTime + 3.5);
  };

  // Flatten columns for playback tracking
  const flatColumns = useMemo(() => {
    const cols: { blockIdx: number, colIdx: number, isBar: boolean }[] = [];
    parsedTabs.forEach((block, bIdx) => {
      if (block.type === 'tab') {
        block.columns.forEach((col, cIdx) => {
          cols.push({ blockIdx: bIdx, colIdx: cIdx, isBar: col.isBar });
        });
      }
    });
    return cols;
  }, [parsedTabs]);

  // Playback logic
  useEffect(() => {
    if (!playing || flatColumns.length === 0) return;
    
    const interval = setInterval(() => {
      setPlayheadIndex(i => {
        const next = i + 1;
        if (next >= flatColumns.length) {
          setPlaying(false);
          return 0;
        }
        return next;
      });
    }, 150 / speed); // Base speed: 150ms per column
    
    return () => clearInterval(interval);
  }, [playing, flatColumns.length, speed]);

  // Auto-scroll to active block
  useEffect(() => {
    if (!playing) return;
    const current = flatColumns[playheadIndex];
    if (current) {
      const blockEl = document.getElementById(`tab-block-${current.blockIdx}`);
      if (blockEl) {
        const rect = blockEl.getBoundingClientRect();
        if (rect.top < 100 || rect.bottom > window.innerHeight - 100) {
          blockEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }
    }
  }, [playheadIndex, playing, flatColumns]);

  // Determine active measure for highlighting
  const activeMeasure = useMemo(() => {
    if (!playing && playheadIndex === 0) return null;
    const current = flatColumns[playheadIndex];
    if (!current) return null;

    const { blockIdx, colIdx } = current;
    const block = parsedTabs[blockIdx];
    if (block.type !== 'tab') return null;

    let startCol = 0;
    let endCol = block.columns.length - 1;

    for (let i = colIdx; i >= 0; i--) {
      if (block.columns[i].isBar) {
        startCol = i;
        break;
      }
    }
    for (let i = colIdx; i < block.columns.length; i++) {
      if (block.columns[i].isBar) {
        endCol = i;
        break;
      }
    }

    return { blockIdx, startCol, endCol };
  }, [playheadIndex, flatColumns, parsedTabs, playing]);

  // Play notes on playhead change
  useEffect(() => {
    if (!playing) return;
    const current = flatColumns[playheadIndex];
    if (!current) return;
    
    const block = parsedTabs[current.blockIdx];
    if (block.type === 'tab') {
      const col = block.columns[current.colIdx];
      if (col.notes && col.notes.length > 0) {
        col.notes.forEach(note => {
          const prefix = block.prefixes[note.stringIdx];
          const baseMidi = getBaseMidiNote(prefix, note.stringIdx, block.prefixes.length);
          playNote(baseMidi + note.fret);
        });
      }
    }
  }, [playheadIndex, playing, flatColumns, parsedTabs]);

  const togglePlay = async () => {
    if (!playing) {
      await initAudio();
    }
    if (playheadIndex >= flatColumns.length - 1) {
      setPlayheadIndex(0);
    }
    setPlaying(!playing);
  };

  return (
    <div className="bg-white text-slate-900 rounded-3xl overflow-hidden shadow-2xl font-sans relative pb-24" ref={containerRef}>
      
      {/* Top Header (Matches Screenshot) */}
      <div className="p-6 border-b border-slate-100">
        <div className="flex justify-between items-start mb-6">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 mb-1">{title}</h1>
            <p className="text-slate-600 underline decoration-slate-300 underline-offset-4">{artist}</p>
          </div>
          <div className="flex gap-4">
            <button className="p-2 hover:bg-slate-100 rounded-full">
              <SlidersHorizontal className="w-6 h-6 text-slate-700" />
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-3 mb-6">
          <button className="flex items-center gap-2 px-4 py-2 bg-emerald-50 text-emerald-700 rounded-full font-medium text-sm border border-emerald-200">
            <CheckCircle2 className="w-4 h-4" /> Backing track
          </button>
          <button className="flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-700 rounded-full font-medium text-sm hover:bg-slate-200 transition-colors">
            <Sparkles className="w-4 h-4" /> Practice
          </button>
          <button className="flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-700 rounded-full font-medium text-sm hover:bg-slate-200 transition-colors">
            <Guitar className="w-4 h-4" /> Get effects
          </button>
        </div>

        <div className="text-slate-700 space-y-1 font-medium">
          <p>Tuning: E A D G B E</p>
          <p>Key: Am</p>
        </div>
      </div>

      {/* Tablature Content */}
      <div className="p-6 space-y-12 overflow-x-auto">
        {parsedTabs.map((block, bIdx) => {
          if (block.type === 'text') {
            return (
              <div 
                key={bIdx} 
                className="text-slate-800 font-bold text-lg whitespace-pre-wrap font-mono"
                style={{ paddingLeft: 'calc(0.5rem + 2px)' }}
              >
                {block.content}
              </div>
            );
          }

          const isBlockActive = activeMeasure?.blockIdx === bIdx;

          return (
            <div key={bIdx} id={`tab-block-${bIdx}`} className="flex items-start pb-4">
              
              {/* Prefixes (e| B| G| etc) */}
              <div className="flex flex-col pr-2 border-r-2 border-slate-800 sticky left-0 bg-white z-30">
                {block.prefixes.map((prefix, pIdx) => (
                  <div key={pIdx} className="h-7 flex items-center justify-end font-mono font-bold text-slate-600">
                    {prefix}
                  </div>
                ))}
              </div>

              {/* Columns */}
              <div className="flex flex-row relative">
                {block.columns.map((col, cIdx) => {
                  const isMeasureActive = isBlockActive && cIdx >= activeMeasure.startCol && cIdx <= activeMeasure.endCol;
                  const isPlayhead = playing && flatColumns[playheadIndex]?.blockIdx === bIdx && flatColumns[playheadIndex]?.colIdx === cIdx;

                  return (
                    <div 
                      key={cIdx} 
                      className={cn(
                        "flex flex-col relative transition-colors duration-75",
                        isMeasureActive ? "bg-[#d0e8f2]" : "bg-white"
                      )}
                    >
                      {/* Playhead Line */}
                      {isPlayhead && (
                        <div className="absolute top-0 bottom-0 left-0 w-[2px] bg-red-500 z-40 shadow-[0_0_10px_rgba(239,68,68,0.5)]" />
                      )}

                      {col.chars.map((char, rIdx) => (
                        <div key={rIdx} className="h-7 w-[1ch] relative flex items-center justify-center">
                          {/* Staff Line */}
                          <div className="absolute left-0 right-0 top-1/2 h-[1px] bg-slate-400 z-0" />
                          
                          {/* Bar Line */}
                          {col.isBar && (
                            <div className="absolute top-0 bottom-0 left-1/2 w-[2px] bg-slate-800 z-10" />
                          )}
                          
                          {/* Number/Character */}
                          {!col.isBar && char !== '-' && char !== ' ' && (
                            <span className={cn(
                              "relative z-20 px-[1px] text-[15px] font-bold font-mono",
                              isMeasureActive ? "bg-[#d0e8f2] text-slate-900" : "bg-white text-slate-900"
                            )}>
                              {char}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Bottom Playback Bar */}
      <div className="fixed bottom-0 left-0 right-0 max-w-4xl mx-auto bg-white border-t border-slate-200 p-4 px-6 flex items-center justify-between z-50 rounded-t-3xl shadow-[0_-10px_40px_rgba(0,0,0,0.05)]">
        <div className="flex items-center gap-4 text-slate-500 font-medium">
          <div className="flex items-center gap-2">
            <Guitar className="w-5 h-5" />
            <span className="hidden sm:inline">Acoustic</span>
          </div>
          <div className="hidden sm:flex items-center gap-2 ml-4">
            <Volume2 className="w-4 h-4" />
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={volume}
              onChange={(e) => setVolume(parseFloat(e.target.value))}
              className="w-20 accent-slate-900"
            />
          </div>
        </div>

        <div className="flex items-center gap-6">
          <button 
            onClick={() => setPlayheadIndex(0)}
            className="flex flex-col items-center text-slate-600 hover:text-slate-900 transition-colors"
          >
            <SkipBack className="w-6 h-6" />
            <span className="text-[10px] font-bold uppercase mt-1">Beginning</span>
          </button>

          <button 
            onClick={togglePlay}
            disabled={isLoadingAudio}
            className="w-16 h-16 bg-slate-900 text-white rounded-full flex items-center justify-center hover:scale-105 transition-transform shadow-lg disabled:opacity-50 disabled:hover:scale-100"
          >
            {isLoadingAudio ? (
              <Loader2 className="w-8 h-8 animate-spin" />
            ) : playing ? (
              <Pause className="w-8 h-8" />
            ) : (
              <Play className="w-8 h-8 ml-1" />
            )}
          </button>

          <button className="flex flex-col items-center text-slate-600 hover:text-slate-900 transition-colors">
            <div className="w-10 h-10 rounded-full border-2 border-slate-300 flex items-center justify-center">
              <Repeat className="w-5 h-5" />
            </div>
            <span className="text-[10px] font-bold uppercase mt-1">Loop</span>
          </button>
        </div>

        <button 
          onClick={() => setSpeed(s => s === 1 ? 0.7 : s === 0.7 ? 0.5 : 1)}
          className="px-4 py-2 bg-slate-100 text-slate-700 rounded-full font-bold text-sm hover:bg-slate-200 transition-colors"
        >
          {speed}x
        </button>
      </div>
    </div>
  );
}
