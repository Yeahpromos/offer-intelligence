export type ExportRow = Readonly<Record<string, unknown>>;
export type ExportCellFormat = "" | "percentage" | "integer";

export type ExportGetter = (
  row: ExportRow,
  index?: number,
  context?: ExportSheetContext
) => unknown;

export type ExportColumn = readonly [
  header: string,
  getter: ExportGetter,
  width?: number,
  format?: ExportCellFormat
];

export interface ExportRowBackgroundRange {
  readonly start?: unknown;
  readonly end?: unknown;
  readonly color?: unknown;
}

export interface ExportSheetContext {
  readonly columns?: readonly ExportColumn[];
  readonly workbookBackgroundColors?: readonly string[];
  readonly rowBackgroundRanges?: readonly ExportRowBackgroundRange[];
  readonly referenceStyle?: boolean;
  readonly wrapText?: boolean;
  readonly freezeHeader?: boolean;
}

export interface ExportSheet extends ExportSheetContext {
  readonly rows: readonly ExportRow[];
  readonly sheetName?: string;
  readonly downloadColumns?: readonly ExportColumn[];
}

export interface WorkbookFile {
  readonly name: string;
  readonly data: string | Uint8Array;
}

export interface WorkbookBuildOptions {
  readonly rows?: readonly ExportRow[];
  readonly columns?: readonly ExportColumn[];
  readonly sheetName?: string;
  readonly sheets?: readonly ExportSheet[];
}

export const TIER_INTEGER_METRIC_HEADERS = new Set([
  "clicks", "total clicks", "dpv", "atc", "order count", "orders",
  "brand count", "publisher count", "publisher count june",
  "new tier entries", "tier exits"
]);

const XLSX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function numeric(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function isRateColumn(header: unknown): boolean {
  const lower = text(header).toLowerCase();
  return /(all commission|aff commission|commission rate|success rate|conversion rate|completion rate|avg conversion|\bconversion\b|\bcvr\b)/.test(lower)
    && !/count/.test(lower);
}

export function normalizeExportColor(value: unknown): string {
  const color = text(value).toUpperCase();
  return /^#[0-9A-F]{6}$/.test(color) ? color : "";
}

export function safeSheetName(value: unknown): string {
  const name = text(value || "Export")
    .replace(/[\[\]:*?/\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 31);
  return name || "Export";
}

export function objectExportColumns(
  rows: readonly ExportRow[],
  preferredHeaders: readonly string[] = []
): ExportColumn[] {
  const headers = preferredHeaders.length
    ? preferredHeaders
    : Array.from(rows.reduce<Set<string>>((set, row) => {
      Object.keys(row || {}).forEach((key) => set.add(key));
      return set;
    }, new Set<string>()));
  return headers.map((header) => [
    header,
    (row: ExportRow) => row && row[header] != null ? row[header] : ""
  ]);
}

export function tierSheetExportFormat(header: unknown): ExportCellFormat {
  const normalizedHeader = text(header).toLowerCase();
  if (isRateColumn(header)) return "percentage";
  if (TIER_INTEGER_METRIC_HEADERS.has(normalizedHeader)) return "integer";
  return "";
}

export function tierSheetExportColumns(
  rows: readonly ExportRow[],
  preferredHeaders: readonly string[] = []
): ExportColumn[] {
  return objectExportColumns(rows, preferredHeaders).map(([header, getter, width]) => [
    header,
    getter,
    width,
    tierSheetExportFormat(header)
  ]);
}

export function xmlEscape(value: unknown): string {
  const escaped: Readonly<Record<string, string>> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&apos;"
  };
  return String(value ?? "").replace(/[&<>"']/g, (character) => escaped[character] || character);
}

export function columnName(index: number): string {
  let name = "";
  let current = index + 1;
  while (current > 0) {
    const remainder = (current - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    current = Math.floor((current - 1) / 26);
  }
  return name;
}

export function worksheetRowBackgroundColor(
  dataRowNumber: number,
  ranges: readonly ExportRowBackgroundRange[] = []
): string {
  const match = ranges.find((range) => (
    dataRowNumber >= numeric(range.start)
    && dataRowNumber <= numeric(range.end)
  ));
  return match ? normalizeExportColor(match.color) : "";
}

export function exportNumberForFormat(value: unknown, format: unknown): number | null {
  if (format !== "percentage" && format !== "integer") return null;
  const valueText = text(value);
  if (!valueText) return null;
  const cleaned = valueText.replace(/[$,%]/g, "").replace(/,/g, "").trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(cleaned)) return null;
  const raw = Number(cleaned);
  if (!Number.isFinite(raw)) return null;
  if (format === "percentage") {
    return Math.abs(raw) <= 1 && !valueText.includes("%") ? raw : raw / 100;
  }
  return Math.round(raw);
}

export function worksheetXml(
  rows: readonly ExportRow[],
  context: ExportSheetContext = {}
): string {
  const columns = context.columns || objectExportColumns(rows);
  const backgroundColors = context.workbookBackgroundColors || [];
  const backgroundRanges = context.rowBackgroundRanges || [];
  const referenceStyle = Boolean(context.referenceStyle);
  const sheetRows: unknown[][] = [
    columns.map(([header]) => header),
    ...rows.map((row, index) => columns.map(([, getter]) => getter(row, index, context)))
  ];
  const rowXml = sheetRows.map((row, rowIndex) => {
    const backgroundColor = rowIndex > 0
      ? worksheetRowBackgroundColor(rowIndex, backgroundRanges)
      : "";
    const backgroundIndex = backgroundColors.indexOf(backgroundColor);
    const cells = row.map((value, colIndex) => {
      const ref = `${columnName(colIndex)}${rowIndex + 1}`;
      const columnFormat = columns[colIndex]?.[3] || "";
      const formatOffset = columnFormat === "percentage" ? 1 : columnFormat === "integer" ? 2 : 0;
      const styleId = rowIndex === 0 && referenceStyle
        ? 3
        : backgroundIndex >= 0
          ? 4 + backgroundIndex * 3 + formatOffset
          : formatOffset;
      const style = styleId ? ` s="${styleId}"` : "";
      const formattedNumber = rowIndex > 0 ? exportNumberForFormat(value, columnFormat) : null;
      if (formattedNumber !== null) return `<c r="${ref}"${style}><v>${formattedNumber}</v></c>`;
      if (typeof value === "number" && Number.isFinite(value)) return `<c r="${ref}"${style}><v>${value}</v></c>`;
      return `<c r="${ref}"${style} t="inlineStr"><is><t>${xmlEscape(value)}</t></is></c>`;
    }).join("");
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join("");
  const widths = columns.map(([, , width], index) => (
    `<col min="${index + 1}" max="${index + 1}" width="${width || (index < 6 ? 18 : 14)}" customWidth="1"/>`
  )).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  ${context.freezeHeader ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' : ""}
  <cols>${widths}</cols>
  <sheetData>${rowXml}</sheetData>
</worksheet>`;
}

export function workbookXml(sheetName: string | readonly string[] = "Recommendations"): string {
  const sheetNames = Array.isArray(sheetName) ? sheetName : [sheetName];
  const sheets = sheetNames.map((name, index) => (
    `<sheet name="${xmlEscape(safeSheetName(name || `Sheet ${index + 1}`))}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`
  )).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>${sheets}</sheets>
</workbook>`;
}

export function workbookRelsXml(sheetCount = 1): string {
  const worksheetRels = Array.from({ length: sheetCount }, (_, index) => (
    `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`
  )).join("\n  ");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${worksheetRels}
  <Relationship Id="rId${sheetCount + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
}

export function rootRelsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;
}

export function contentTypesXml(sheetCount = 1): string {
  const worksheetTypes = Array.from({ length: sheetCount }, (_, index) => (
    `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
  )).join("\n  ");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  ${worksheetTypes}
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;
}

export function stylesXml(backgroundColors: readonly string[] = [], wrapText = false): string {
  const colors = backgroundColors
    .map(normalizeExportColor)
    .filter((color, index, values) => color && values.indexOf(color) === index);
  const colorFills = colors.map((color) => (
    `<fill><patternFill patternType="solid"><fgColor rgb="FF${color.slice(1)}"/><bgColor indexed="64"/></patternFill></fill>`
  )).join("");
  const colorCellXfs = colors.map((color, index) => {
    const fillId = index + 3;
    return `<xf numFmtId="0" fontId="0" fillId="${fillId}" borderId="1" applyFill="1" applyBorder="1"/>
    <xf numFmtId="10" fontId="0" fillId="${fillId}" borderId="1" applyNumberFormat="1" applyFill="1" applyBorder="1"/>
    <xf numFmtId="1" fontId="0" fillId="${fillId}" borderId="1" applyNumberFormat="1" applyFill="1" applyBorder="1"/>`;
  }).join("\n    ");
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2">
    <font><sz val="11"/><name val="Calibri"/></font>
    <font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font>
  </fonts>
  <fills count="${colors.length + 3}">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF1F4E78"/><bgColor indexed="64"/></patternFill></fill>
    ${colorFills}
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border><left style="thin"><color rgb="FFD9E2F3"/></left><right style="thin"><color rgb="FFD9E2F3"/></right><top style="thin"><color rgb="FFD9E2F3"/></top><bottom style="thin"><color rgb="FFD9E2F3"/></bottom><diagonal/></border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="${4 + colors.length * 3}">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
    <xf numFmtId="10" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"/>
    <xf numFmtId="1" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>
    ${colorCellXfs}
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
  // Opt in per workbook so other exports retain their established styles.
  return wrapText ? styles.replace(/<cellXfs([\s\S]*?)<\/cellXfs>/, block => block
    .replace(/<xf([^>]*?)\/>/g, '<xf$1 applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>')
    .replace('<alignment horizontal="center"/>', '<alignment horizontal="center" vertical="center" wrapText="1"/>')) : styles;
}

function crc32(bytes: Uint8Array): number {
  const table = Array.from({ length: 256 }, (_, n) => {
    let value = n;
    for (let index = 0; index < 8; index += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    return value >>> 0;
  });
  let checksum = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    const tableValue = table[(checksum ^ bytes[index]!) & 0xff] || 0;
    checksum = tableValue ^ (checksum >>> 8);
  }
  return (checksum ^ 0xffffffff) >>> 0;
}

function uint16(value: number): Uint8Array {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, value, true);
  return bytes;
}

function uint32(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value >>> 0, true);
  return bytes;
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  parts.forEach((part) => {
    output.set(part, offset);
    offset += part.length;
  });
  return output;
}

function dosTimestamp(): { readonly time: number; readonly day: number } {
  const date = new Date();
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

export function createZip(files: readonly WorkbookFile[]): Uint8Array {
  const encoder = new TextEncoder();
  const { time, day } = dosTimestamp();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  files.forEach((file) => {
    const nameBytes = encoder.encode(file.name);
    const dataBytes = typeof file.data === "string" ? encoder.encode(file.data) : file.data;
    const checksum = crc32(dataBytes);
    const local = concatBytes([
      uint32(0x04034b50), uint16(20), uint16(0x0800), uint16(0), uint16(time), uint16(day),
      uint32(checksum), uint32(dataBytes.length), uint32(dataBytes.length), uint16(nameBytes.length), uint16(0),
      nameBytes, dataBytes
    ]);
    const central = concatBytes([
      uint32(0x02014b50), uint16(20), uint16(20), uint16(0x0800), uint16(0), uint16(time), uint16(day),
      uint32(checksum), uint32(dataBytes.length), uint32(dataBytes.length), uint16(nameBytes.length), uint16(0), uint16(0),
      uint16(0), uint16(0), uint32(0), uint32(offset), nameBytes
    ]);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  });
  const centralDirectory = concatBytes(centrals);
  const end = concatBytes([
    uint32(0x06054b50), uint16(0), uint16(0), uint16(files.length), uint16(files.length),
    uint32(centralDirectory.length), uint32(offset), uint16(0)
  ]);
  return concatBytes([...locals, centralDirectory, end]);
}

function uniqueWorkbookSheetName(name: unknown, usedNames: Set<string>): string {
  const base = safeSheetName(name || "Export");
  let candidate = base;
  let index = 2;
  while (usedNames.has(candidate.toLowerCase())) {
    const suffix = ` ${index}`;
    candidate = `${base.slice(0, Math.max(1, 31 - suffix.length))}${suffix}`;
    index += 1;
  }
  usedNames.add(candidate.toLowerCase());
  return candidate;
}

function normalizeWorkbookSheets(sheets: readonly ExportSheet[]): ExportSheet[] {
  const usedNames = new Set<string>();
  const source = sheets.length ? sheets : [{ rows: [], sheetName: "Export" }];
  return source.map((sheet, index) => {
    const rows = sheet.rows || [];
    return {
      ...sheet,
      rows,
      sheetName: uniqueWorkbookSheetName(sheet.sheetName || `Sheet ${index + 1}`, usedNames),
      columns: sheet.columns || sheet.downloadColumns || objectExportColumns(rows)
    };
  });
}

export function buildWorkbookFiles(sheets: readonly ExportSheet[]): WorkbookFile[] {
  const normalizedSheets = normalizeWorkbookSheets(sheets);
  const sheetCount = normalizedSheets.length;
  const workbookBackgroundColors = normalizedSheets
    .flatMap((sheet) => (sheet.rowBackgroundRanges || []).map((range) => normalizeExportColor(range.color)))
    .filter((color, index, values) => color && values.indexOf(color) === index);
  return [
    { name: "[Content_Types].xml", data: contentTypesXml(sheetCount) },
    { name: "_rels/.rels", data: rootRelsXml() },
    { name: "xl/workbook.xml", data: workbookXml(normalizedSheets.map((sheet) => sheet.sheetName || "Export")) },
    { name: "xl/_rels/workbook.xml.rels", data: workbookRelsXml(sheetCount) },
    { name: "xl/styles.xml", data: stylesXml(workbookBackgroundColors, sheets.some(sheet => sheet.wrapText)) },
    ...normalizedSheets.map((sheet, index) => ({
      name: `xl/worksheets/sheet${index + 1}.xml`,
      data: worksheetXml(sheet.rows, { ...sheet, workbookBackgroundColors })
    }))
  ];
}

export function buildWorkbook(options: WorkbookBuildOptions | readonly ExportSheet[]): Uint8Array {
  if (Array.isArray(options)) return createZip(buildWorkbookFiles(options as readonly ExportSheet[]));
  const buildOptions = options as WorkbookBuildOptions;
  const sheets = buildOptions.sheets?.length
    ? buildOptions.sheets
    : [{
        rows: buildOptions.rows || [],
        columns: buildOptions.columns,
        sheetName: buildOptions.sheetName || "Export"
      }];
  return createZip(buildWorkbookFiles(sheets));
}

export function downloadWorkbook(
  filename: string,
  options: WorkbookBuildOptions | readonly ExportSheet[]
): boolean {
  const workbook = buildWorkbook(options);
  const blobBytes = workbook.slice();
  const blob = new Blob([blobBytes.buffer], { type: XLSX_MIME_TYPE });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
  return true;
}
