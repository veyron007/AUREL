/**
 * Columnar FIRMS payload: the `/api/firms?format=columns` body.
 *
 * The row form repeats eleven key names on every detection, and a world pull
 * holds 100k+ detections. The column form sends each field once as a parallel
 * array. Fields whose values are not all finite numbers (confidence, date,
 * time, satellite, instrument, day/night) are dictionary-encoded: the column
 * holds indices into a small table of distinct values.
 *
 * Decoding restores exactly the records the row body carries after a JSON
 * round trip: same fields, same values, same order. Index -1 marks a field a
 * record did not have, so an absent key stays absent instead of reading null.
 * Pure functions, no Cesium/DOM/network; shared by server and client.
 */

export const FIRMS_COLUMNS_FORMAT = 'columns';
const ABSENT = -1;

/**
 * Field names in first-seen order across every record.
 * @param {ReadonlyArray<object>} records
 * @returns {string[]}
 */
function collectFields(records) {
  const fields = new Set();
  for (const record of records) {
    for (const key of Object.keys(record)) fields.add(key);
  }
  return [...fields];
}

/** Whether every record holds a finite number for this field. */
function isNumericField(records, field) {
  for (const record of records) {
    if (!Number.isFinite(record[field])) return false;
  }
  return true;
}

/**
 * One dictionary-encoded column. Values are compared after JSON
 * normalisation so the table only holds values JSON can carry.
 */
function encodeDictionaryColumn(records, field) {
  const table = [];
  const indexByValue = new Map();
  const column = new Array(records.length);
  for (let i = 0; i < records.length; i++) {
    // JSON drops an undefined value with its key, so both read as absent.
    const value = records[i][field];
    if (value === undefined) {
      column[i] = ABSENT;
      continue;
    }
    let index = indexByValue.get(value);
    if (index === undefined) {
      index = table.length;
      table.push(value);
      indexByValue.set(value, index);
    }
    column[i] = index;
  }
  return { column, table };
}

/**
 * Encode row records into parallel columns.
 * @param {ReadonlyArray<object>} records
 * @returns {{fields: string[], columns: Record<string, Array<number>>, dictionaries: Record<string, Array<unknown>>}}
 */
export function encodeFirmsColumns(records) {
  const fields = collectFields(records);
  const columns = {};
  const dictionaries = {};
  for (const field of fields) {
    if (isNumericField(records, field)) {
      columns[field] = records.map((record) => record[field]);
      continue;
    }
    const { column, table } = encodeDictionaryColumn(records, field);
    columns[field] = column;
    dictionaries[field] = table;
  }
  return { fields, columns, dictionaries };
}

/**
 * Validate a columnar body before decoding. Throws with a reason, never
 * returns a partial set.
 * @param {{fields?: unknown, columns?: unknown, dictionaries?: unknown, count?: unknown}} payload
 * @returns {number} Row count.
 */
function validateColumns(payload) {
  const { fields, columns, dictionaries } = payload;
  if (!Array.isArray(fields) || !columns || typeof columns !== 'object')
    throw new Error('Malformed columnar fire snapshot');
  if (dictionaries !== undefined && typeof dictionaries !== 'object')
    throw new Error('Malformed columnar fire dictionaries');
  const length = fields.length ? columns[fields[0]]?.length : 0;
  if (!Number.isInteger(length))
    throw new Error('Malformed columnar fire snapshot');
  for (const field of fields) {
    if (!Array.isArray(columns[field]) || columns[field].length !== length)
      throw new Error(`Columnar fire field ${field} has the wrong length`);
  }
  return length;
}

/**
 * One column's per-row values, resolved through its dictionary when it has
 * one; `undefined` marks an absent field. Rejects an index outside the table.
 */
function resolveColumn(field, column, table) {
  if (!table) return column;
  const values = new Array(column.length);
  // Hot loop over 100k+ rows: fills an array nobody else holds yet.
  for (let i = 0; i < column.length; i++) {
    const index = column[i];
    if (index === ABSENT) continue;
    if (!Number.isInteger(index) || index < 0 || index >= table.length)
      throw new Error(`Columnar fire field ${field} has a bad index`);
    values[i] = table[index];
  }
  return values;
}

/**
 * Decode a columnar body back into row records.
 * @param {{fields: string[], columns: Record<string, Array<number>>, dictionaries?: Record<string, Array<unknown>>}} payload
 * @returns {object[]}
 */
export function decodeFirmsColumns(payload) {
  const length = validateColumns(payload);
  const { fields, columns } = payload;
  const dictionaries = payload.dictionaries || {};
  const values = fields.map((field) =>
    resolveColumn(field, columns[field], dictionaries[field]),
  );
  const records = new Array(length);
  // Hot loop over 100k+ rows: each record is a new object filled in place
  // before anyone else can see it.
  for (let i = 0; i < length; i++) {
    const record = {};
    for (let f = 0; f < fields.length; f++) {
      const value = values[f][i];
      if (value !== undefined) record[fields[f]] = value;
    }
    records[i] = record;
  }
  return records;
}
