import PDFDocument from "pdfkit";

/** A format-neutral document: reports are described once as blocks, then laid out here. */
export type PdfBlock =
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "paragraph"; text: string; muted?: boolean }
  | { kind: "facts"; rows: [label: string, value: string][] }
  | { kind: "table"; headers: string[]; rows: string[][]; /** Relative column widths. */ widths?: number[] }
  | { kind: "list"; items: string[]; ordered?: boolean }
  | { kind: "note"; text: string };

export interface PdfDocumentSpec {
  title: string;
  subtitle?: string;
  /** Printed at the bottom of every page, before "page x of y". */
  footer: string;
  blocks: PdfBlock[];
}

// Characters the built-in PDF fonts (WinAnsi) can show, beyond printable ASCII and Latin-1.
const CP1252_EXTRAS = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";
const REPLACEMENTS: Record<string, string> = {
  "→": "->",
  "←": "<-",
  "↔": "<->",
  "≥": ">=",
  "≤": "<=",
  "≠": "!=",
  "−": "-",
  "‐": "-",
  "‑": "-",
  "✓": "yes",
  " ": " ",
  " ": " ",
  " ": " ",
};

const isWinAnsi = (ch: string): boolean => {
  const c = ch.codePointAt(0) ?? 0;
  return c === 0x0a || (c >= 0x20 && c <= 0x7e) || (c >= 0xa1 && c <= 0xff) || CP1252_EXTRAS.includes(ch);
};

/** Maps text to what the built-in fonts can draw; counts what had to become "?" so the report can say so. */
export function pdfSafe(text: string): { text: string; replaced: number } {
  let replaced = 0;
  let out = "";
  for (const ch of text.normalize("NFC")) {
    const mapped = REPLACEMENTS[ch];
    if (mapped !== undefined) out += mapped;
    else if (isWinAnsi(ch)) out += ch;
    else {
      out += "?";
      replaced++;
    }
  }
  return { text: out, replaced };
}

const INK = "#1F2421";
const MUTED = "#4A524C";
const ACCENT = "#2F6B5E"; // pine, the app's default accent
const RULE = "#C3B9A7";
const SOFT = "#F2EEE4";
const MARGIN = { top: 56, bottom: 64, left: 56, right: 56 };

export interface RenderOptions {
  /** Leave streams uncompressed so tests can read the text back. */
  compress?: boolean;
}

/** Lays the blocks out on A4 with built-in fonts (no font files, no network). */
export function renderPdf(spec: PdfDocumentSpec, options: RenderOptions = {}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let replaced = 0;
    const safe = (t: string) => {
      const r = pdfSafe(t);
      replaced += r.replaced;
      return r.text;
    };
    const doc = new PDFDocument({
      size: "A4",
      margins: MARGIN,
      bufferPages: true,
      compress: options.compress ?? true,
      info: { Title: safe(spec.title), Author: "Sentinel", Creator: "Sentinel", Producer: "Sentinel (pdfkit)" },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const width = () => doc.page.width - MARGIN.left - MARGIN.right;
    const bottom = () => doc.page.height - MARGIN.bottom;
    const ensure = (height: number) => {
      if (doc.y + height > bottom()) doc.addPage();
    };
    const textHeight = (t: string, w: number, font: string, size: number) => {
      doc.font(font).fontSize(size);
      return doc.heightOfString(t, { width: w });
    };

    try {
      doc.font("Helvetica-Bold").fontSize(9).fillColor(ACCENT).text("SENTINEL", { characterSpacing: 1.5 });
      doc.moveDown(0.4);
      doc.font("Helvetica-Bold").fontSize(20).fillColor(INK).text(safe(spec.title), { width: width() });
      if (spec.subtitle) {
        doc.moveDown(0.3);
        doc.font("Helvetica").fontSize(10.5).fillColor(MUTED).text(safe(spec.subtitle), { width: width() });
      }
      doc.moveDown(0.6);
      doc.moveTo(MARGIN.left, doc.y).lineTo(MARGIN.left + width(), doc.y).lineWidth(1.5).strokeColor(ACCENT).stroke();
      doc.moveDown(0.8);

      for (const block of spec.blocks) {
        // Positioned text (tables, facts) leaves the cursor at its last column; flowing text starts at the margin.
        doc.x = MARGIN.left;
        switch (block.kind) {
          case "heading": {
            const size = block.level === 1 ? 15 : block.level === 2 ? 12.5 : 10.5;
            ensure(size * 1.4 + 40); // keep a heading with at least a few lines after it
            doc.moveDown(block.level === 1 ? 0.8 : 0.6);
            doc.font("Helvetica-Bold").fontSize(size).fillColor(block.level === 3 ? MUTED : INK).text(safe(block.text), { width: width() });
            doc.moveDown(0.3);
            break;
          }
          case "paragraph": {
            const t = safe(block.text);
            ensure(textHeight(t, width(), "Helvetica", 9.5));
            doc.font("Helvetica").fontSize(9.5).fillColor(block.muted ? MUTED : INK).text(t, { width: width(), lineGap: 2 });
            doc.moveDown(0.4);
            break;
          }
          case "note": {
            const t = safe(block.text);
            const h = textHeight(t, width() - 20, "Helvetica-Oblique", 9) + 14;
            ensure(h);
            const y = doc.y;
            doc.rect(MARGIN.left, y, width(), h).fillColor(SOFT).fill();
            doc.rect(MARGIN.left, y, 3, h).fillColor(ACCENT).fill();
            doc.font("Helvetica-Oblique").fontSize(9).fillColor(INK).text(t, MARGIN.left + 12, y + 7, { width: width() - 20 });
            doc.y = y + h;
            doc.moveDown(0.6);
            break;
          }
          case "list": {
            block.items.forEach((item, i) => {
              const t = safe(item);
              const bullet = block.ordered ? `${i + 1}.` : "-";
              ensure(textHeight(t, width() - 18, "Helvetica", 9.5));
              const y = doc.y;
              doc.font("Helvetica").fontSize(9.5).fillColor(MUTED).text(bullet, MARGIN.left, y, { width: 14 });
              doc.fillColor(INK).text(t, MARGIN.left + 18, y, { width: width() - 18, lineGap: 1.5 });
              doc.moveDown(0.15);
            });
            doc.moveDown(0.3);
            break;
          }
          case "facts": {
            const labelW = 130;
            for (const [label, value] of block.rows) {
              const l = safe(label);
              const v = safe(value);
              const h = Math.max(textHeight(l, labelW, "Helvetica-Bold", 9.5), textHeight(v, width() - labelW, "Helvetica", 9.5));
              ensure(h + 3);
              const y = doc.y;
              doc.font("Helvetica-Bold").fontSize(9.5).fillColor(MUTED).text(l, MARGIN.left, y, { width: labelW });
              doc.font("Helvetica").fillColor(INK).text(v, MARGIN.left + labelW, y, { width: width() - labelW });
              doc.y = y + h + 3;
            }
            doc.moveDown(0.3);
            break;
          }
          case "table": {
            const total = (block.widths ?? block.headers.map(() => 1)).reduce((a, b) => a + b, 0);
            const widths = (block.widths ?? block.headers.map(() => 1)).map((w) => (w / total) * width());
            const pad = 4;
            const drawRow = (cells: string[], header: boolean) => {
              const font = header ? "Helvetica-Bold" : "Helvetica";
              const texts = cells.map(safe);
              const h = Math.max(...texts.map((t, i) => textHeight(t, (widths[i] ?? 60) - pad * 2, font, 8.5))) + pad * 2;
              if (doc.y + h > bottom()) {
                doc.addPage();
                if (!header) drawRow(block.headers, true);
              }
              const y = doc.y;
              if (header) doc.rect(MARGIN.left, y, width(), h).fillColor(SOFT).fill();
              let x = MARGIN.left;
              texts.forEach((t, i) => {
                doc.font(font).fontSize(8.5).fillColor(header ? MUTED : INK).text(t, x + pad, y + pad, { width: (widths[i] ?? 60) - pad * 2 });
                x += widths[i] ?? 60;
              });
              doc.moveTo(MARGIN.left, y + h).lineTo(MARGIN.left + width(), y + h).lineWidth(0.5).strokeColor(RULE).stroke();
              doc.y = y + h;
            };
            drawRow(block.headers, true);
            if (block.rows.length === 0) drawRow(["None", ...block.headers.slice(1).map(() => "")], false);
            for (const row of block.rows) drawRow(row, false);
            doc.moveDown(0.8);
            break;
          }
        }
      }

      if (replaced > 0) {
        ensure(40);
        doc.moveDown(0.5);
        doc.font("Helvetica-Oblique").fontSize(8.5).fillColor(MUTED).text(`${replaced} character(s) outside the Latin-1 range cannot be drawn with the built-in PDF fonts and were replaced with "?". The online version keeps the original text.`, { width: width() });
      }

      // Footers need every page to exist, so they are drawn last.
      const { count } = { count: doc.bufferedPageRange().count };
      for (let i = 0; i < count; i++) {
        doc.switchToPage(i);
        // Writing inside the bottom margin would otherwise add a page.
        doc.page.margins.bottom = 0;
        doc.font("Helvetica").fontSize(7.5).fillColor(MUTED).text(`${safe(spec.footer)} - page ${i + 1} of ${count}`, MARGIN.left, doc.page.height - 40, { width: width(), align: "center", lineBreak: false });
      }
      doc.end();
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}
