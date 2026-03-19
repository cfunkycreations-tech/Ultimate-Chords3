const NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT_NOTES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

export function transposeChord(chord: string, steps: number): string {
  if (!chord) return chord;
  
  // Handle complex chords like C/E, Am7, etc.
  // We only transpose the root note and the bass note if it exists.
  const parts = chord.split('/');
  
  const transposePart = (part: string) => {
    const match = part.match(/^([A-G][#b]?)(.*)$/);
    if (!match) return part;
    
    let [, root, suffix] = match;
    
    let isFlat = root.includes('b');
    let index = NOTES.indexOf(root);
    if (index === -1) {
      index = FLAT_NOTES.indexOf(root);
      isFlat = true;
    }
    
    if (index === -1) return part; // Unknown chord root
    
    let newIndex = (index + steps) % 12;
    if (newIndex < 0) newIndex += 12;
    
    // Prefer sharps for general transposing unless original was flat
    const newRoot = isFlat ? FLAT_NOTES[newIndex] : NOTES[newIndex];
    return newRoot + suffix;
  };

  return parts.map(transposePart).join('/');
}

export interface ParsedLine {
  type: 'lyric' | 'chord' | 'empty' | 'directive' | 'tab';
  content?: string;
  segments?: { chord?: string; lyric: string }[];
}

export function extractOriginalCapo(text: string): number {
  const match = text.match(/\[?capo:?\s*(\d+)\]?/i);
  if (match) {
    return parseInt(match[1], 10);
  }
  return 0;
}

export function parseChordPro(text: string, transposeSteps: number = 0): ParsedLine[] {
  const lines = text.split('\n');
  const parsed: ParsedLine[] = [];
  let inTab = false;

  for (let line of lines) {
    line = line.trimEnd();
    if (line === '') {
      parsed.push({ type: 'empty' });
      continue;
    }

    if (line === '{start_of_tab}') {
      inTab = true;
      continue;
    }
    if (line === '{end_of_tab}') {
      inTab = false;
      continue;
    }

    if (inTab) {
      parsed.push({ type: 'tab', content: line });
      continue;
    }

    if (line.startsWith('{') && line.endsWith('}')) {
      parsed.push({ type: 'directive', content: line.slice(1, -1) });
      continue;
    }

    // Check if it's a chordpro line with [Chord]
    if (line.includes('[')) {
      const segments: { chord?: string; lyric: string }[] = [];
      let currentLyric = '';
      let currentChord = '';
      let inChord = false;

      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '[') {
          if (currentLyric || currentChord) {
            segments.push({ 
              chord: currentChord ? transposeChord(currentChord, transposeSteps) : undefined, 
              lyric: currentLyric 
            });
          }
          currentLyric = '';
          currentChord = '';
          inChord = true;
        } else if (char === ']') {
          inChord = false;
        } else if (inChord) {
          currentChord += char;
        } else {
          currentLyric += char;
        }
      }
      
      if (currentLyric || currentChord) {
        segments.push({ 
          chord: currentChord ? transposeChord(currentChord, transposeSteps) : undefined, 
          lyric: currentLyric 
        });
      }
      
      parsed.push({ type: 'chord', segments });
    } else {
      // Just lyrics
      parsed.push({ type: 'lyric', content: line });
    }
  }

  return parsed;
}
