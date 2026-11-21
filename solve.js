// Fast drop-in for make.fun's csv-reader 1.0.0.
// Same answer for every input, but reads fields in bulk (indexOf + slice)
// instead of one character at a time. Pure: no state kept between calls.

const COMMA = 0;      // field ended at a comma
const LINE_BREAK = 1; // field ended at a line break
const END = 2;        // field ended at the end of the text

/** csv-reader 1.0.0's answer for one case's input, faster. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;
  const n = text.length;
  let pos = 0;
  let line = 1;
  if (n > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it takes (null: the header).
  // These are captured per record and used by every error inside it.
  let recordLine = 1;
  let recordRow = null;

  // Reads unquoted characters onto `value` up to the next comma or line break,
  // starting at the shared `pos` and advancing it. A CR not followed by LF is
  // dropped (stray_cr). Returns {value, ended, added}; `added` counts the
  // characters kept (for quote_junk detection).
  function readUnquoted(value) {
    let added = 0;
    let cur = value;
    while (pos < n) {
      // Next delimiter: ',', '\n' or '\r' (native scans).
      const iC = text.indexOf(',', pos);
      const iN = text.indexOf('\n', pos);
      const iR = text.indexOf('\r', pos);
      let next = -1;
      let kind = -1; // 0 comma, 1 LF, 2 CR
      if (iC !== -1) { next = iC; kind = 0; }
      if (iN !== -1 && (next === -1 || iN < next)) { next = iN; kind = 1; }
      if (iR !== -1 && (next === -1 || iR < next)) { next = iR; kind = 2; }
      if (next === -1) {
        // No more delimiters: the rest of the text is the field.
        if (pos < n) { cur += text.slice(pos, n); added += n - pos; }
        pos = n;
        return { value: cur, ended: END, added };
      }
      if (kind === 0) {
        // Comma.
        if (next > pos) { cur += text.slice(pos, next); added += next - pos; }
        pos = next + 1;
        return { value: cur, ended: COMMA, added };
      }
      if (kind === 1) {
        // LF.
        if (next > pos) { cur += text.slice(pos, next); added += next - pos; }
        pos = next + 1;
        line += 1;
        return { value: cur, ended: LINE_BREAK, added };
      }
      // CR: CRLF is a line break; a lone CR is dropped (stray_cr).
      if (next + 1 < n && text.charCodeAt(next + 1) === 10) {
        if (next > pos) { cur += text.slice(pos, next); added += next - pos; }
        pos = next + 2;
        line += 1;
        return { value: cur, ended: LINE_BREAK, added };
      }
      if (next > pos) { cur += text.slice(pos, next); added += next - pos; }
      errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
      pos = next + 1;
      // Continue: more field after the dropped CR.
    }
    return { value: cur, ended: END, added };
  }

  // Reads a quoted field whose opening quote is at the shared `pos`,
  // advancing it. Returns {value, ended}.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    pos += 1; // skip the opening quote
    let value = '';
    let segments = null; // only when a doubled quote ("") appears
    let cur = pos; // start of the current segment
    let q;
    while (true) {
      q = text.indexOf('"', pos);
      if (q === -1) {
        // The quote never closes: literal character, re-read as unquoted.
        pos = open + 1;
        line = openLine;
        errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
        return readUnquoted('"');
      }
      if (q + 1 < n && text.charCodeAt(q + 1) === 34) {
        // Doubled quote: one literal quote, keep scanning.
        if (segments === null) segments = [];
        segments.push(text.slice(cur, q));
        segments.push('"');
        pos = q + 2;
        cur = pos;
        continue;
      }
      // Closing quote at q.
      if (segments === null) {
        value = text.slice(cur, q);
      } else {
        segments.push(text.slice(cur, q));
        value = segments.join('');
      }
      break;
    }
    // Normalise CR/LF inside quotes to LF and count the lines they span.
    if (value.indexOf('\r') !== -1 || value.indexOf('\n') !== -1) {
      const breaks = value.match(/\r\n|\r|\n/g);
      if (breaks !== null) line += breaks.length;
      value = value.replace(/\r\n?/g, '\n');
    }
    pos = q + 1; // after the closing quote
    if (pos >= n) return { value, ended: END };
    const c = text.charCodeAt(pos);
    if (c === 44) { // ','
      pos += 1;
      return { value, ended: COMMA };
    }
    if (c === 10) { // '\n'
      pos += 1;
      line += 1;
      return { value, ended: LINE_BREAK };
    }
    if (c === 13 && pos + 1 < n && text.charCodeAt(pos + 1) === 10) { // '\r\n'
      pos += 2;
      line += 1;
      return { value, ended: LINE_BREAK };
    }
    // What follows the closing quote is appended as it stands (quote_junk).
    const junk = readUnquoted(value);
    if (junk.added > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
    return junk;
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) { // '\n'
        pos += 1;
        line += 1;
      } else if (c === 13 && pos + 1 < n && text.charCodeAt(pos + 1) === 10) { // '\r\n'
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let field;
    let quoted;
    do {
      quoted = pos < n && text.charCodeAt(pos) === 34; // '"'
      field = quoted ? readQuoted() : readUnquoted('');
      fields.push(field.value);
    } while (field.ended === COMMA);

    // A line that held only stray CRs is left with no characters: no record.
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
