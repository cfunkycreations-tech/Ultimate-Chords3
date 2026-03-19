import { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Settings2, X } from 'lucide-react';
import { cn } from '../lib/utils';

// YIN Pitch Detection Algorithm - highly accurate for guitar/bass
// It is much better than standard autocorrelation at avoiding octave errors
// and detecting the true fundamental frequency of lower strings.
function yinPitchDetection(buf: Float32Array, sampleRate: number) {
  let rms = 0;
  for (let i = 0; i < buf.length; i++) {
    rms += buf[i] * buf[i];
  }
  rms = Math.sqrt(rms / buf.length);
  if (rms < 0.005) return -1; // Silence or background noise

  const tauMax = Math.floor(buf.length / 2);
  const yinBuffer = new Float32Array(tauMax);
  yinBuffer[0] = 1;
  let runningSum = 0;
  let foundTau = -1;
  const threshold = 0.15; // Standard YIN threshold

  for (let tau = 1; tau < tauMax; tau++) {
    let difference = 0;
    for (let i = 0; i < tauMax; i++) {
      const delta = buf[i] - buf[i + tau];
      difference += delta * delta;
    }
    runningSum += difference;
    yinBuffer[tau] = difference * tau / runningSum;

    // Absolute thresholding
    if (yinBuffer[tau] < threshold) {
      // Find the local minimum
      while (tau + 1 < tauMax && yinBuffer[tau + 1] < yinBuffer[tau]) {
        tau++;
      }
      foundTau = tau;
      break;
    }
  }

  // Fallback if no dip goes below the threshold
  if (foundTau === -1) {
    let minVal = Infinity;
    for (let tau = 1; tau < tauMax; tau++) {
      if (yinBuffer[tau] < minVal) {
        minVal = yinBuffer[tau];
        foundTau = tau;
      }
    }
    if (minVal > 0.4) return -1; // Not periodic enough
  }

  // Parabolic interpolation for sub-sample accuracy
  let betterTau = foundTau;
  if (foundTau > 0 && foundTau < tauMax - 1) {
    const s0 = yinBuffer[foundTau - 1];
    const s1 = yinBuffer[foundTau];
    const s2 = yinBuffer[foundTau + 1];
    
    const denominator = s0 + s2 - 2 * s1;
    if (denominator !== 0) {
      betterTau = foundTau + (s0 - s2) / (2 * denominator);
    }
  }

  return sampleRate / betterTau;
}

const noteStrings = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

function noteFromPitch(frequency: number, referencePitch: number = 440) {
  const noteNum = 12 * (Math.log(frequency / referencePitch) / Math.log(2));
  return Math.round(noteNum) + 69;
}

function frequencyFromNoteNumber(note: number, referencePitch: number = 440) {
  return referencePitch * Math.pow(2, (note - 69) / 12);
}

function centsOffFromPitch(frequency: number, note: number, referencePitch: number = 440) {
  return Math.floor(1200 * Math.log(frequency / frequencyFromNoteNumber(note, referencePitch)) / Math.log(2));
}

const TUNING_STANDARDS: Record<string, string[]> = {
  "Standard": ["E", "A", "D", "G", "B", "E"],
  "Drop D": ["D", "A", "D", "G", "B", "E"],
  "Drop C": ["C", "G", "C", "F", "A", "D"],
  "Open G": ["D", "G", "D", "G", "B", "D"],
  "Open D": ["D", "A", "D", "F#", "A", "D"],
  "Half Step Down": ["D#", "G#", "C#", "F#", "A#", "D#"],
  "Full Step Down": ["D", "G", "C", "F", "A", "D"],
};

export function Tuner() {
  const [isListening, setIsListening] = useState(false);
  const [pitch, setPitch] = useState<number | null>(null);
  const [note, setNote] = useState<string>("--");
  const [cents, setCents] = useState<number>(0);
  const [accuracy, setAccuracy] = useState<number>(0);
  const [volume, setVolume] = useState<number>(0);
  
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [referencePitch, setReferencePitch] = useState<number>(440);
  const [tuningStandard, setTuningStandard] = useState<string>("Standard");
  
  const referencePitchRef = useRef(referencePitch);
  useEffect(() => {
    referencePitchRef.current = referencePitch;
  }, [referencePitch]);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const rafIdRef = useRef<number | null>(null);
  
  const smoothedCentsRef = useRef<number>(0);
  const pitchHistoryRef = useRef<number[]>([]);
  const currentNoteRef = useRef<string>("--");

  const startListening = async () => {
    try {
      // Disable audio processing features that ruin instrument pitch detection
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: false,
          autoGainControl: false,
          noiseSuppression: false
        } 
      });
      mediaStreamRef.current = stream;
      
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioContextRef.current = audioCtx;
      
      // Add a low-pass filter to remove high harmonics that confuse pitch detection.
      // Guitar fundamentals are mostly below 1000Hz. This makes the fundamental much clearer.
      const lowpass = audioCtx.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.value = 1000;
      lowpass.Q.value = 0.707;
      
      const analyser = audioCtx.createAnalyser();
      // 4096 gives great low-frequency resolution (crucial for Low E string ~82Hz)
      analyser.fftSize = 4096; 
      analyserRef.current = analyser;
      
      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(lowpass);
      lowpass.connect(analyser);
      
      setIsListening(true);
      updatePitch();
    } catch (err) {
      console.error("Error accessing microphone:", err);
      alert("Could not access microphone. Please ensure permissions are granted.");
    }
  };

  const stopListening = () => {
    if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
    }
    setIsListening(false);
    setPitch(null);
    setNote("--");
    setCents(0);
    setAccuracy(0);
    setVolume(0);
    smoothedCentsRef.current = 0;
    pitchHistoryRef.current = [];
    currentNoteRef.current = "--";
    
    // Clear canvas
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    }
  };

  const updatePitch = () => {
    if (!analyserRef.current || !audioContextRef.current) return;
    
    const buffer = new Float32Array(analyserRef.current.fftSize);
    analyserRef.current.getFloatTimeDomainData(buffer);
    
    // Calculate volume for visual feedback
    let rms = 0;
    for (let i = 0; i < buffer.length; i++) {
      rms += buffer[i] * buffer[i];
    }
    const currentVolume = Math.sqrt(rms / buffer.length);
    setVolume(currentVolume);

    const ac = yinPitchDetection(buffer, audioContextRef.current.sampleRate);
    
    // Filter out extreme frequencies (guitar range is roughly 82Hz to 1200Hz)
    if (ac !== -1 && ac > 40 && ac < 2000) { 
      // Median filter to reject octave jumps and noise
      pitchHistoryRef.current.push(ac);
      if (pitchHistoryRef.current.length > 5) {
        pitchHistoryRef.current.shift();
      }
      
      const sorted = [...pitchHistoryRef.current].sort((a, b) => a - b);
      const medianPitch = sorted[Math.floor(sorted.length / 2)];

      const noteNum = noteFromPitch(medianPitch, referencePitchRef.current);
      const noteStr = noteStrings[noteNum % 12];
      const centsOff = centsOffFromPitch(medianPitch, noteNum, referencePitchRef.current);
      
      // If the note changed completely, reset the smoothing to snap to the new note
      if (noteStr !== currentNoteRef.current) {
        smoothedCentsRef.current = centsOff;
        currentNoteRef.current = noteStr;
      } else {
        // Smooth the cents movement so the needle doesn't jitter wildly
        smoothedCentsRef.current = smoothedCentsRef.current * 0.8 + centsOff * 0.2;
      }
      
      setPitch(medianPitch);
      setNote(noteStr);
      setCents(smoothedCentsRef.current);
      setAccuracy(Math.max(0, 100 - (Math.abs(smoothedCentsRef.current) * 2)));
    } else if (currentVolume < 0.01) {
      // Clear history on silence to prepare for the next attack cleanly
      pitchHistoryRef.current = [];
      setAccuracy(0);
    }
    
        // Canvas Drawing
        const canvas = canvasRef.current;
        if (canvas && analyserRef.current) {
          const ctx = canvas.getContext('2d');
          if (ctx) {
            const width = canvas.width;
            const height = canvas.height;
            ctx.clearRect(0, 0, width, height);

            let rgb = '82, 82, 91'; // zinc-600
            let bgAlpha = 0;
            
            if (pitchHistoryRef.current.length > 0 && currentVolume > 0.01) {
               bgAlpha = Math.min(0.3, currentVolume * 2.5); // Dynamic glow based on volume
               if (Math.abs(smoothedCentsRef.current) < 5) rgb = '52, 211, 105'; // emerald
               else if (smoothedCentsRef.current <= -5) rgb = '251, 191, 36'; // amber
               else if (smoothedCentsRef.current >= 5) rgb = '244, 63, 94'; // rose
            }

            // Draw dynamic background gradient
            if (bgAlpha > 0) {
              const gradient = ctx.createRadialGradient(
                width / 2, height / 2, 0, 
                width / 2, height / 2, width / 1.5
              );
              gradient.addColorStop(0, `rgba(${rgb}, ${bgAlpha})`);
              gradient.addColorStop(0.5, `rgba(${rgb}, ${bgAlpha * 0.4})`);
              gradient.addColorStop(1, `rgba(${rgb}, 0)`);
              ctx.fillStyle = gradient;
              ctx.fillRect(0, 0, width, height);
            }

            // Spectrum Analyzer
            const freqData = new Uint8Array(analyserRef.current.frequencyBinCount);
            analyserRef.current.getByteFrequencyData(freqData);
            const numBins = 150;
            const barWidth = width / numBins;
            let xFreq = 0;

            ctx.fillStyle = `rgba(${rgb}, 0.15)`;
            for (let i = 0; i < numBins; i++) {
              const percent = freqData[i] / 255;
              const barHeight = percent * height;
              ctx.fillRect(xFreq, height - barHeight, barWidth - 1, barHeight);
              xFreq += barWidth;
            }

            // Waveform
            ctx.beginPath();
            ctx.lineWidth = 4;
            ctx.strokeStyle = `rgba(${rgb}, 0.9)`;
            
            // Add glow to the waveform line
            ctx.shadowBlur = 15;
            ctx.shadowColor = `rgba(${rgb}, 0.8)`;

            // Zero-crossing for stable waveform
            let startIdx = 0;
            for (let i = 0; i < 1000; i++) {
              if (buffer[i] < 0 && buffer[i+1] >= 0) {
                startIdx = i;
                break;
              }
            }

            const drawLen = Math.min(1024, buffer.length - startIdx);
            const sliceWidth = width / drawLen;
            let xWave = 0;
            for (let i = 0; i < drawLen; i++) {
              const v = buffer[startIdx + i] * 3.0; // amplify
              let y = (height / 2) + (v * height / 2);
              y = Math.max(0, Math.min(height, y)); // clamp

              if (i === 0) ctx.moveTo(xWave, y);
              else ctx.lineTo(xWave, y);
              xWave += sliceWidth;
            }
            ctx.stroke();
            
            // Reset shadow for next frame
            ctx.shadowBlur = 0;
          }
        }

    rafIdRef.current = requestAnimationFrame(updatePitch);
  };

  useEffect(() => {
    return () => {
      stopListening();
    };
  }, []);

  const isTuned = Math.abs(cents) < 5 && isListening && pitch !== null;
  const isFlat = cents <= -5 && isListening && pitch !== null;
  const isSharp = cents >= 5 && isListening && pitch !== null;

  // Map cents (-50 to 50) to percentage (0% to 100%)
  const indicatorPosition = Math.max(0, Math.min(100, 50 + (cents / 50) * 50));

  return (
    <div className="max-w-3xl mx-auto py-12 px-4 space-y-12">
      <div className="text-center space-y-4 relative">
        <h1 className="text-4xl font-bold tracking-tight">Pro Tuner</h1>
        <p className="text-zinc-400">High-precision chromatic tuner. Pluck a string to begin.</p>
        <button
          onClick={() => setIsSettingsOpen(true)}
          className="absolute top-0 right-0 p-2 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded-full transition-colors"
          title="Tuner Settings"
        >
          <Settings2 className="w-6 h-6" />
        </button>
      </div>

      <div className="bg-zinc-900/50 backdrop-blur-xl border border-zinc-800/50 rounded-[3rem] p-8 md:p-16 relative overflow-hidden shadow-2xl ring-1 ring-white/5">
        
        {/* Real-time Visualizer Canvas */}
        <canvas
          ref={canvasRef}
          width={1000}
          height={400}
          className="absolute inset-0 w-full h-full opacity-100 pointer-events-none z-0"
        />

        {/* Target Notes for Selected Tuning - Prominent Display */}
        <div className="relative z-10 flex justify-center items-center gap-3 md:gap-6 mb-8">
          {TUNING_STANDARDS[tuningStandard].map((targetNote, i) => {
            const isMatch = note === targetNote && isListening && pitch !== null;
            return (
              <div 
                key={i} 
                className={cn(
                  "flex flex-col items-center justify-center w-12 h-12 md:w-16 md:h-16 rounded-full border-2 transition-all duration-300",
                  isMatch 
                    ? "border-yellow-400 bg-yellow-400/20 text-yellow-400 scale-110 shadow-[0_0_20px_rgba(250,204,21,0.4)]" 
                    : "border-zinc-800 bg-zinc-900/50 text-zinc-600"
                )}
              >
                <span className="text-xl md:text-2xl font-bold font-mono">{targetNote}</span>
                <span className="text-[10px] md:text-xs font-medium opacity-50 absolute -bottom-5">
                  {TUNING_STANDARDS[tuningStandard].length - i}
                </span>
              </div>
            );
          })}
        </div>

        {/* Status Indicator */}
        <div className="relative z-10 flex justify-between items-center mb-12 text-sm font-bold tracking-widest uppercase">
          <span className={cn("transition-colors duration-300", isFlat ? "text-amber-400" : "text-zinc-600")}>Flat</span>
          <span className={cn("transition-colors duration-300", isTuned ? "text-emerald-400" : "text-zinc-600")}>Tune</span>
          <span className={cn("transition-colors duration-300", isSharp ? "text-rose-400" : "text-zinc-600")}>Sharp</span>
        </div>

        {/* Note Display */}
        <div className="text-center mb-16 relative z-10">
          <div className={cn(
            "text-[10rem] md:text-[14rem] font-black leading-none tracking-tighter transition-all duration-300",
            !isListening || !pitch ? "text-zinc-800" :
            isTuned ? "text-emerald-400 drop-shadow-[0_0_40px_rgba(52,211,105,0.4)] scale-110" : 
            isFlat ? "text-amber-400 drop-shadow-[0_0_30px_rgba(251,191,36,0.2)]" : 
            "text-rose-400 drop-shadow-[0_0_30px_rgba(244,63,94,0.2)]"
          )}>
            {note}
          </div>
          
          <div className="absolute top-full left-1/2 -translate-x-1/2 mt-4 flex flex-col items-center gap-4">
            <div className="text-2xl font-mono text-zinc-400 font-medium">
              {pitch ? `${pitch.toFixed(1)} Hz` : '---.- Hz'}
            </div>
            {pitch && (
              <div className="flex items-center gap-3">
                <div className={cn(
                  "text-sm font-medium px-3 py-1 rounded-full transition-colors duration-300",
                  isTuned ? "bg-emerald-500/10 text-emerald-400" : "bg-zinc-800 text-zinc-400"
                )}>
                  {cents > 0 ? '+' : ''}{Math.round(cents)} cents
                </div>
                <div className={cn(
                  "text-sm font-medium px-3 py-1 rounded-full transition-colors duration-300",
                  isTuned ? "bg-emerald-500/10 text-emerald-400" : "bg-zinc-800 text-zinc-400"
                )}>
                  {Math.round(accuracy)}% Accurate
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Tuning Bar */}
        <div className="relative z-10 h-24 mt-24 mb-8">
          {/* Center Target Line */}
          <div className="absolute left-1/2 top-0 bottom-0 w-1 bg-zinc-700 -translate-x-1/2 rounded-full z-0"></div>
          
          {/* Tick Marks */}
          <div className="absolute inset-0 flex justify-between items-center px-4 opacity-20 pointer-events-none">
            {[...Array(21)].map((_, i) => (
              <div key={i} className={cn(
                "w-0.5 rounded-full",
                i === 10 ? "h-12 bg-emerald-500" : i % 5 === 0 ? "h-8 bg-zinc-400" : "h-4 bg-zinc-500"
              )}></div>
            ))}
          </div>

          {/* Moving Indicator */}
          <div 
            className={cn(
              "absolute top-1/2 -translate-y-1/2 w-6 h-16 rounded-full shadow-lg transition-all duration-75 z-10 -ml-3",
              !isListening || !pitch ? "bg-zinc-700 opacity-0" :
              isTuned ? "bg-emerald-400 shadow-[0_0_20px_rgba(52,211,105,0.6)]" : 
              isFlat ? "bg-amber-400 shadow-[0_0_20px_rgba(251,191,36,0.4)]" : 
              "bg-rose-400 shadow-[0_0_20px_rgba(244,63,94,0.4)]"
            )}
            style={{ left: `${indicatorPosition}%` }}
          ></div>
        </div>

        {/* Mic Activity Visualizer */}
        <div className="absolute bottom-0 left-0 right-0 h-1 bg-zinc-800">
          <div 
            className="h-full bg-yellow-500 transition-all duration-75 opacity-50"
            style={{ width: `${Math.min(100, volume * 500)}%` }}
          ></div>
        </div>
      </div>

      {/* Controls */}
      <div className="flex justify-center">
        <button
          onClick={isListening ? stopListening : startListening}
          className={cn(
            "flex items-center gap-3 px-8 py-4 rounded-full font-bold text-lg transition-all duration-300",
            isListening 
              ? "bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:scale-105" 
              : "bg-yellow-500 text-zinc-950 hover:bg-yellow-400 shadow-[0_0_30px_rgba(234,179,8,0.3)] hover:scale-105"
          )}
        >
          {isListening ? (
            <>
              <MicOff className="w-6 h-6" />
              Stop Tuner
            </>
          ) : (
            <>
              <Mic className="w-6 h-6" />
              Start Tuner
            </>
          )}
        </button>
      </div>

      {/* Settings Modal */}
      {isSettingsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold">Tuner Settings</h2>
              <button 
                onClick={() => setIsSettingsOpen(false)}
                className="p-2 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded-full transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="space-y-6">
              {/* Reference Pitch */}
              <div className="space-y-3">
                <label className="text-sm font-medium text-zinc-400">Reference Pitch (A4)</label>
                <div className="flex items-center gap-4">
                  <input 
                    type="range" 
                    min="415" 
                    max="460" 
                    value={referencePitch}
                    onChange={(e) => setReferencePitch(Number(e.target.value))}
                    className="flex-1 accent-yellow-500"
                  />
                  <div className="w-16 text-right font-mono font-medium">
                    {referencePitch} Hz
                  </div>
                </div>
              </div>

              {/* Tuning Standard */}
              <div className="space-y-3">
                <label className="text-sm font-medium text-zinc-400">Tuning Standard</label>
                <div className="grid grid-cols-2 gap-2">
                  {Object.entries(TUNING_STANDARDS).map(([name, notes]) => (
                    <button
                      key={name}
                      onClick={() => setTuningStandard(name)}
                      className={cn(
                        "px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left flex flex-col gap-1",
                        tuningStandard === name 
                          ? "bg-yellow-500/10 text-yellow-500 border border-yellow-500/20" 
                          : "bg-zinc-950 text-zinc-400 border border-zinc-800 hover:bg-zinc-800"
                      )}
                    >
                      <span>{name}</span>
                      <span className="text-xs opacity-60 font-mono">{notes.join(' ')}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
