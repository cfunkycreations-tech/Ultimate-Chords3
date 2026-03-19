export interface TabNote {
  stringIdx: number;
  fret: number;
}

export interface TabColumn {
  chars: string[];
  isBar: boolean;
  notes?: TabNote[];
}

export interface TabBlockData {
  type: 'tab';
  prefixes: string[];
  columns: TabColumn[];
}

export interface TextBlockData {
  type: 'text';
  content: string;
}

export type ParsedTabContent = TabBlockData | TextBlockData;

export function parseGuitarTab(text: string): ParsedTabContent[] {
  const lines = text.split('\n');
  const result: ParsedTabContent[] = [];
  let currentTabBlock: string[] = [];
  let currentTextBlock: string[] = [];

  const isTabLine = (line: string) => {
    // Matches standard tab lines like "e|", "E |", "B|", "|", "1|", etc.
    return /^([a-gA-G1-6][b#]?\s*\||\|)/.test(line.trim());
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimEnd();
    
    // Skip chordpro directives in tab view to keep it clean
    if (line.startsWith('{') && line.endsWith('}')) {
      continue;
    }

    if (isTabLine(line)) {
      if (currentTextBlock.length > 0) {
        result.push({ type: 'text', content: currentTextBlock.join('\n') });
        currentTextBlock = [];
      }
      currentTabBlock.push(line);
      
      // A standard guitar tab block has 6 lines
      if (currentTabBlock.length === 6) {
        const prefixes = currentTabBlock.map(r => {
          const match = r.match(/^.*?\|/);
          return match ? match[0] : '|';
        });
        
        const contentRows = currentTabBlock.map((r, idx) => r.slice(prefixes[idx].length));
        const maxLen = Math.max(...contentRows.map(r => r.length));
        const paddedRows = contentRows.map(r => r.padEnd(maxLen, '-'));

        const columns: TabColumn[] = [];
        for (let c = 0; c < maxLen; c++) {
          const chars = paddedRows.map(r => r[c]);
          const isBar = chars.every(ch => ch === '|');
          columns.push({ chars, isBar, notes: [] });
        }

        paddedRows.forEach((row, stringIdx) => {
          const regex = /\d+/g;
          let match;
          while ((match = regex.exec(row)) !== null) {
            const fret = parseInt(match[0], 10);
            const startCol = match.index;
            if (columns[startCol] && columns[startCol].notes) {
              columns[startCol].notes!.push({ stringIdx, fret });
            }
          }
        });

        result.push({ type: 'tab', prefixes, columns });
        currentTabBlock = [];
      }
    } else {
      if (currentTabBlock.length > 0) {
        currentTextBlock.push(...currentTabBlock);
        currentTabBlock = [];
      }
      if (line.trim() !== '') {
        currentTextBlock.push(line);
      }
    }
  }
  
  if (currentTextBlock.length > 0) {
    result.push({ type: 'text', content: currentTextBlock.join('\n') });
  }
  if (currentTabBlock.length > 0) {
    result.push({ type: 'text', content: currentTabBlock.join('\n') });
  }
  
  return result;
}
