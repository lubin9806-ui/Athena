import * as cheerio from 'cheerio';
import JSZip from 'jszip';
import { validateOoxmlArchive } from './OoxmlArchive';

const MAX_SHEETS = 24;
const MAX_ROWS_PER_SHEET = 5_000;
const MAX_COLUMNS = 256;
const MAX_CELL_CHARS = 2_000;

interface SheetEntry {
  name: string;
  path: string;
}

/**
 * Renders a workbook as the tab-separated text a model can actually read, one
 * block per sheet. Cells keep their grid position so a column still lines up
 * with its header; blank trailing cells are dropped rather than padded.
 *
 * Values are taken as stored, which means a date arrives as the serial number
 * Excel keeps underneath it — resolving that needs the number-format table and
 * is not worth the surface area here.
 */
export async function extractSpreadsheetText(bytes: Buffer): Promise<string> {
  validateOoxmlArchive(bytes, 'XLSX');
  const archive = await JSZip.loadAsync(bytes);

  const sharedStrings = await readSharedStrings(archive);
  const sheets = await readSheetIndex(archive);
  if (sheets.length === 0) throw new Error('这个工作簿里没有可读取的工作表。');

  const blocks: string[] = [];
  for (const sheet of sheets.slice(0, MAX_SHEETS)) {
    const file = archive.file(sheet.path);
    if (!file) continue;
    const rows = renderSheet(await file.async('string'), sharedStrings);
    if (rows.length === 0) continue;
    blocks.push([`[工作表：${sheet.name}]`, ...rows].join('\n'));
  }
  if (blocks.length === 0) throw new Error('这个工作簿里没有可读取的单元格内容。');
  return blocks.join('\n\n');
}

async function readSharedStrings(archive: JSZip): Promise<string[]> {
  const file = archive.file('xl/sharedStrings.xml');
  if (!file) return [];
  const $ = cheerio.load(await file.async('string'), { xml: true });
  // A shared string is either one <t>, or several inside <r> runs that have to
  // be concatenated in document order to rebuild the original cell text.
  return $('si').map((_, element) => $(element).find('t').map((__, node) => $(node).text()).get().join('')).get();
}

async function readSheetIndex(archive: JSZip): Promise<SheetEntry[]> {
  const workbookFile = archive.file('xl/workbook.xml');
  if (!workbookFile) throw new Error('这个文件不是可读取的 Excel 工作簿。');
  const relsFile = archive.file('xl/_rels/workbook.xml.rels');
  const targets = new Map<string, string>();
  if (relsFile) {
    const $rels = cheerio.load(await relsFile.async('string'), { xml: true });
    $rels('Relationship').each((_, element) => {
      const id = $rels(element).attr('Id');
      const target = $rels(element).attr('Target');
      if (id && target) targets.set(id, normalizeSheetPath(target));
    });
  }

  const $ = cheerio.load(await workbookFile.async('string'), { xml: true });
  const sheets: SheetEntry[] = [];
  $('sheets > sheet').each((index, element) => {
    const name = $(element).attr('name') || `Sheet${index + 1}`;
    const relationId = $(element).attr('r:id') || $(element).attr('id');
    const target = relationId ? targets.get(relationId) : undefined;
    sheets.push({ name, path: target || `xl/worksheets/sheet${index + 1}.xml` });
  });
  return sheets;
}

function normalizeSheetPath(target: string): string {
  const cleaned = target.replace(/^\/+/, '').replace(/^xl\//, '');
  return `xl/${cleaned}`;
}

function renderSheet(xml: string, sharedStrings: string[]): string[] {
  const $ = cheerio.load(xml, { xml: true });
  const lines: string[] = [];
  let rowCount = 0;

  $('sheetData > row').each((_, rowElement) => {
    if (rowCount >= MAX_ROWS_PER_SHEET) return false;
    const cells: string[] = [];
    $(rowElement).find('c').each((__, cellElement) => {
      const cell = $(cellElement);
      const column = columnIndex(cell.attr('r') || '');
      if (column < 0 || column >= MAX_COLUMNS) return;
      const value = readCell(cell, $, sharedStrings);
      while (cells.length < column) cells.push('');
      cells[column] = value;
    });
    while (cells.length > 0 && cells[cells.length - 1] === '') cells.pop();
    if (cells.length > 0) {
      lines.push(cells.join('\t'));
      rowCount += 1;
    }
    return undefined;
  });
  return lines;
}

function readCell(cell: cheerio.Cheerio<any>, $: cheerio.CheerioAPI, sharedStrings: string[]): string {
  const type = cell.attr('t');
  let value: string;
  if (type === 's') {
    const index = Number(cell.find('v').first().text());
    value = Number.isInteger(index) && index >= 0 && index < sharedStrings.length ? sharedStrings[index] : '';
  } else if (type === 'inlineStr') {
    value = cell.find('is t').map((_, node) => $(node).text()).get().join('');
  } else {
    value = cell.find('v').first().text();
  }
  const flattened = value.replace(/[\r\n\t]+/g, ' ').trim();
  return flattened.length > MAX_CELL_CHARS ? `${flattened.slice(0, MAX_CELL_CHARS)}…` : flattened;
}

/** "BC12" -> 54. Returns -1 when the reference carries no column letters. */
function columnIndex(reference: string): number {
  const letters = reference.match(/^[A-Z]+/i)?.[0];
  if (!letters) return -1;
  let index = 0;
  for (const character of letters.toUpperCase()) index = index * 26 + (character.charCodeAt(0) - 64);
  return index - 1;
}
