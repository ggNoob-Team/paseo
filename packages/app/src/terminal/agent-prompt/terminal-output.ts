function stripAnsiSequences(value: string): string {
  let result = "";
  let index = 0;
  while (index < value.length) {
    if (value.charCodeAt(index) !== 27) {
      result += value[index];
      index += 1;
      continue;
    }
    index += 1;
    if (index >= value.length) {
      break;
    }
    const next = value.charCodeAt(index);
    if (next === 91) {
      index += 1;
      while (index < value.length) {
        const code = value.charCodeAt(index);
        index += 1;
        if (code >= 0x40 && code <= 0x7e) {
          break;
        }
      }
      continue;
    }
    if (next === 93) {
      index += 1;
      while (index < value.length) {
        const code = value.charCodeAt(index);
        if (code === 7) {
          index += 1;
          break;
        }
        if (code === 27 && value.charCodeAt(index + 1) === 92) {
          index += 2;
          break;
        }
        index += 1;
      }
      continue;
    }
    index += 1;
  }
  return result;
}

function stripControlCharacters(value: string): string {
  let result = "";
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code === 9 || code === 10 || code === 13 || code >= 32) {
      result += character;
    }
  }
  return result;
}

function trimTrailingSpaces(value: string): string {
  let end = value.length;
  while (end > 0) {
    const code = value.charCodeAt(end - 1);
    if (code !== 32 && code !== 9) {
      break;
    }
    end -= 1;
  }
  return end === value.length ? value : value.slice(0, end);
}

/**
 * Turns raw PTY output into readable text for the operator panel and summary
 * prompt: drops terminal control sequences, applies carriage-return overwrites,
 * and removes trailing spaces and excess blank lines.
 */
export function sanitizeTerminalOutput(raw: string): string {
  const withoutSequences = stripControlCharacters(stripAnsiSequences(raw));
  const newline = String.fromCharCode(10);
  const carriageReturn = String.fromCharCode(13);
  const resolved = withoutSequences.split(newline).map((line) => {
    const frame = line.endsWith(carriageReturn) ? line.slice(0, -1) : line;
    const lastCarriageReturn = frame.lastIndexOf(carriageReturn);
    const effectiveLine = lastCarriageReturn >= 0 ? frame.slice(lastCarriageReturn + 1) : frame;
    return trimTrailingSpaces(effectiveLine);
  });
  const compacted: string[] = [];
  let previousWasBlank = false;
  for (const line of resolved) {
    const isBlank = line.trim().length === 0;
    if (isBlank && previousWasBlank) {
      continue;
    }
    compacted.push(line);
    previousWasBlank = isBlank;
  }
  return compacted.join(newline).trim();
}

export function concatByteChunks(chunks: Iterable<Uint8Array>): Uint8Array {
  let total = 0;
  for (const chunk of chunks) {
    total += chunk.length;
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

export function truncateTerminalText(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  return text.slice(0, maxChars) + String.fromCharCode(10) + "...[truncated]";
}
