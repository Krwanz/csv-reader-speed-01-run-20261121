// A fast CSV reader with csv-reader 1.0.0's exact broken-row policy.
//
// run(input) reads {text, header} once, left to right, and answers
// {columns, rows, errors} exactly as csv-reader 1.0.0 does:
//   - a U+FEFF at the very start is dropped;
//   - a record ends at LF or CRLF, and a line left with no characters is no record;
//   - outside quotes a CR not followed by LF is dropped (error stray_cr);
//   - a field that opens with a quote runs to the next quote that is not doubled,
//     "" inside it is one quote and each CRLF or lone CR inside it is read as LF;
//     what follows its closing quote, up to the next comma or line break, is
//     appended as it stands (quote_junk, when the field ends); a quote that never
//     closes is a literal character, and the text after it is read again as
//     unquoted (unterminated_quote);
//   - a quote inside an unquoted field is a literal character;
//   - fields stay strings, never trimmed or converted;
//   - columns is the first record when header is true, else null; rows holds the
//     records after it (every record when header is false), each padded with ""
//     (short_row, with fields: its field count) or cut (long_row, with extra:
//     the cut fields) to the first record's width;
//   - each error is {code, line, row}, in the order met; line is the 1-based line
//     its record starts on, counting every LF, CRLF and lone CR inside quotes,
//     and row is its record's index in rows, null for the header.
//
// Speed comes from letting the engine do the scanning instead of walking
// character by character: an unquoted field is one slice that ends at the next
// comma or at the end of its line (the line end is found once per record and
// refreshed only when a quoted field has carried the read past it), a quoted
// field is one slice between its opening quote and the next quote that is not
// doubled (found with indexOf), and the rare broken pieces (stray CRs, doubled
// quotes, line breaks inside quotes, junk after a closing quote, a quote that
// never closes) take a short slow path of their own.

// How a field ended: 0 at a comma, 1 at a line break, 2 at the end of the text.

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const len = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (len > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it takes.
  let recordLine = 1;
  let recordRow = null;
  // The first LF at or after the record's start (len when there is none left):
  // an unquoted field never runs past it, so it bounds every unquoted slice.
  // A quoted field may carry the read past it; the unquoted path refreshes it
  // whenever pos has moved beyond it.
  let lineEnd = len;

  // Reads an unquoted field starting at pos, with `prefix` already in front of
  // it: the quoted value for junk after a closing quote, '"' for the re-read of
  // a quote that never closes. Returns its value, how it ended, and how many
  // characters were kept after the prefix (only the junk path reads that
  // count). A CR inside the slice to the next comma or line break is always a
  // stray one: a CR followed by LF would have made that LF the line break the
  // slice stops at, so every CR found here is dropped and reported, in order.
  // This is the cold path, used only after a closing quote or an unterminated
  // one; plain unquoted fields are read inline in the record loop below.
  function unquoted(prefix) {
    let ci = text.indexOf(',', pos);
    if (ci < 0) ci = len;
    let ni = text.indexOf('\n', pos);
    if (ni < 0) ni = len;
    let end;
    let ended;
    if (ci < ni) {
      end = ci;
      ended = 0;
    } else if (ni < len) {
      end = ni;
      ended = 1;
    } else {
      end = len;
      ended = 2;
    }
    let segEnd = end;
    if (ended === 1 && end > pos && text.charCodeAt(end - 1) === 13) segEnd = end - 1;
    let seg = text.slice(pos, segEnd);
    let added;
    const ri = seg.indexOf('\r');
    if (ri < 0) {
      added = seg.length;
    } else {
      let count = 0;
      for (let j = ri; j >= 0; j = seg.indexOf('\r', j + 1)) count++;
      for (let k = 0; k < count; k++) {
        errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
      }
      seg = seg.replaceAll('\r', '');
      added = seg.length;
    }
    const value = prefix === '' ? seg : prefix + seg;
    if (ended === 0) {
      pos = end + 1;
    } else if (ended === 1) {
      pos = end + 1;
      line += 1;
    } else {
      pos = len;
    }
    return { value, ended, added };
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < len) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= len) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    lineEnd = text.indexOf('\n', pos);
    if (lineEnd < 0) lineEnd = len;
    const fields = [];
    let value;
    let ended;
    let quoted = false;
    do {
      quoted = text.charCodeAt(pos) === 34;
      if (!quoted) {
        // A plain unquoted field: one slice to the next comma, or to the end
        // of its line. A CR in the slice is a stray one (see unquoted above).
        if (pos > lineEnd) {
          lineEnd = text.indexOf('\n', pos);
          if (lineEnd < 0) lineEnd = len;
        }
        const ci = text.indexOf(',', pos);
        let segEnd;
        if (ci >= 0 && ci < lineEnd) {
          segEnd = ci;
          ended = 0;
        } else if (lineEnd < len) {
          segEnd = lineEnd;
          if (segEnd > pos && text.charCodeAt(segEnd - 1) === 13) segEnd -= 1;
          ended = 1;
        } else {
          segEnd = len;
          ended = 2;
        }
        value = text.slice(pos, segEnd);
        const ri = value.indexOf('\r');
        if (ri >= 0) {
          let count = 0;
          for (let j = ri; j >= 0; j = value.indexOf('\r', j + 1)) count++;
          for (let k = 0; k < count; k++) {
            errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
          }
          value = value.replaceAll('\r', '');
        }
        if (ended === 0) {
          pos = ci + 1;
        } else if (ended === 1) {
          pos = lineEnd + 1;
          line += 1;
        } else {
          pos = len;
        }
      } else {
        // A quoted field: find its closing quote, the next quote that is not
        // doubled. A quote that never closes is handled below.
        const open = pos;
        const openLine = line;
        let p = pos + 1;
        let close = -1;
        let doubled = false;
        while (true) {
          const q = text.indexOf('"', p);
          if (q < 0) break;
          if (text.charCodeAt(q + 1) === 34) {
            doubled = true;
            p = q + 2;
            continue;
          }
          close = q;
          break;
        }
        if (close < 0) {
          // The quote never closes: it is a literal character, and the text
          // after it is read again as unquoted.
          pos = open + 1;
          line = openLine;
          errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
          const f = unquoted('"');
          value = f.value;
          ended = f.ended;
        } else {
          // The value is the slice between the quotes, unless it holds doubled
          // quotes ("" becomes one ") or line breaks (each CRLF or lone CR
          // becomes one LF, and each counts one line).
          const ni = text.indexOf('\n', open + 1);
          const hasNl = ni >= 0 && ni < close;
          const ri = text.indexOf('\r', open + 1);
          const hasCr = ri >= 0 && ri < close;
          if (!hasNl && !hasCr) {
            value = doubled ? text.slice(open + 1, close).replaceAll('""', '"') : text.slice(open + 1, close);
          } else {
            let s = text.slice(open + 1, close);
            const breaks = s.match(/\r\n|\r|\n/g);
            if (breaks !== null) line += breaks.length;
            if (doubled) s = s.replaceAll('""', '"');
            if (hasCr) s = s.replace(/\r\n?/g, '\n');
            value = s;
          }
          pos = close + 1;
          if (pos >= len) {
            ended = 2;
          } else {
            const c = text.charCodeAt(pos);
            if (c === 44) {
              pos += 1;
              ended = 0;
            } else if (c === 10) {
              pos += 1;
              line += 1;
              ended = 1;
            } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
              pos += 2;
              line += 1;
              ended = 1;
            } else {
              // What follows the closing quote is appended as it stands, up
              // to the next comma or line break.
              const f = unquoted(value);
              if (f.added > 0) {
                errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
              }
              value = f.value;
              ended = f.ended;
            }
          }
        }
      }
      fields.push(value);
    } while (ended === 0);

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
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
