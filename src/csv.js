// Reading and writing CSV text.
// Handles quoted fields, commas and line breaks inside quotes, doubled quotes (""),
// Windows (\r\n) and old Mac (\r) line endings, and the invisible byte-order mark
// that Excel and some iPhone apps put at the start of a file.

/** Turn CSV text into an array of rows, each row an array of strings. Blank lines are dropped. */
export function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    if (!(row.length === 1 && row[0] === '')) rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      endField();
    } else if (c === '\n') {
      endRow();
    } else if (c === '\r') {
      if (text[i + 1] === '\n') i++;
      endRow();
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length > 0) endRow();
  return rows;
}

/** Turn an array of rows into CSV text. Every field is quoted, which every spreadsheet app accepts. */
export function toCsv(rows) {
  return rows
    .map((row) => row.map((v) => `"${String(v ?? '').replaceAll('"', '""')}"`).join(','))
    .join('\r\n') + '\r\n';
}
