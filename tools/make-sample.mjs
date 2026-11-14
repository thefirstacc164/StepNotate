import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PDFLib = require(join(root, "extension/vendor/pdf-lib/pdf-lib.min.js"));

const { StandardFonts, rgb, PDFDocument } = PDFLib;

const INK = rgb(0.106, 0.122, 0.141);
const ACCENT = rgb(0.847, 0.282, 0.165);
const MUTED = rgb(0.42, 0.44, 0.47);
const RULE = rgb(0.85, 0.84, 0.81);

async function main() {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const italic = await doc.embedFont(StandardFonts.HelveticaOblique);
  const mono = await doc.embedFont(StandardFonts.Courier);

  const W = 612;
  const H = 792;
  const M = 64;

  function header(page, section) {
    page.drawLine({ start: { x: M, y: H - 54 }, end: { x: W - M, y: H - 54 }, thickness: 1, color: RULE });
    page.drawText("STEPNOTATE", { x: M, y: H - 46, size: 8.5, font: bold, color: ACCENT, characterSpacing: 1.6 });
    page.drawText(section, { x: W - M - regular.widthOfTextAtSize(section, 8.5), y: H - 46, size: 8.5, font: regular, color: MUTED });
    page.drawLine({ start: { x: M, y: 54 }, end: { x: W - M, y: 54 }, thickness: 1, color: RULE });
  }

  function footer(page, n, total) {
    const label = `${n} / ${total}`;
    page.drawText(label, { x: W - M - mono.widthOfTextAtSize(label, 8), y: 40, size: 8, font: mono, color: MUTED });
    page.drawText("A sample document for trying out marks", { x: M, y: 40, size: 8, font: italic, color: MUTED });
  }

  function wrap(text, font, size, max) {
    const words = text.split(" ");
    const lines = [];
    let line = "";
    for (const w of words) {
      const t = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(t, size) > max && line) {
        lines.push(line);
        line = w;
      } else {
        line = t;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  function para(page, text, x, y, size, font, color, max, leading) {
    const lines = wrap(text, font, size, max);
    lines.forEach((l, i) => {
      page.drawText(l, { x, y: y - i * leading, size, font, color });
    });
    return y - lines.length * leading;
  }

  const total = 3;

  {
    const page = doc.addPage([W, H]);
    header(page, "Field guide");
    let y = H - 120;
    page.drawText("Working with StepNotate", { x: M, y, size: 30, font: bold, color: INK });
    y -= 34;
    page.drawText("A quick tour of the marks you can make on this page.", { x: M, y, size: 13, font: italic, color: MUTED });
    y -= 36;

    y = para(
      page,
      "Select the highlight tool and drag across any sentence below. The mark snaps to the text, not to your cursor, so it stays honest when you zoom. Underline and strikethrough live in the same place: select text first, then pick the mark from the floating bar.",
      M,
      y,
      11.5,
      regular,
      INK,
      W - 2 * M,
      17
    );
    y -= 22;

    page.drawText("Try these next", { x: M, y, size: 15, font: bold, color: INK });
    y -= 24;

    const tips = [
      ["Pen and marker", "Draw freehand with the pen, or lay down translucent colour with the marker. Hold Shift for a straight line."],
      ["Shapes", "Press R for a rectangle, then drag. Shift constrains it to a square. Arrows and lines sit in the same flyout."],
      ["Notes and text", "Drop a sticky note with N, or click with T to type a box straight onto the page."],
      ["Signature", "Press G, draw once, and your signature is kept for every document after this one."],
    ];
    for (const [title, body] of tips) {
      page.drawRectangle({ x: M, y: y - 4, width: 3, height: 34, color: ACCENT, opacity: 0.9 });
      page.drawText(title, { x: M + 14, y: y + 14, size: 11.5, font: bold, color: INK });
      y = para(page, body, M + 14, y - 2, 10.5, regular, MUTED, W - 2 * M - 14, 15);
      y -= 18;
    }

    y -= 8;
    page.drawRectangle({ x: M, y: y - 66, width: W - 2 * M, height: 74, color: rgb(0.98, 0.97, 0.94), borderColor: RULE, borderWidth: 1 });
    page.drawText("Everything here runs locally.", { x: M + 16, y: y - 12, size: 11.5, font: bold, color: INK });
    para(
      page,
      "Files never leave this browser. Marks are stored in local storage, exports are written on your machine, and there is nothing to sign up for.",
      M + 16,
      y - 30,
      10.5,
      regular,
      MUTED,
      W - 2 * M - 32,
      15
    );
    footer(page, 1, total);
  }

  {
    const page = doc.addPage([W, H]);
    header(page, "Reference");
    let y = H - 120;
    page.drawText("Keyboard reference", { x: M, y, size: 24, font: bold, color: INK });
    y -= 34;

    const rows = [
      ["V", "Select tool", "Click marks to move, resize or delete them"],
      ["H", "Highlight", "Drag across text to highlight it"],
      ["P / M", "Pen / marker", "Freehand ink over the page"],
      ["T", "Text box", "Click anywhere and start typing"],
      ["N", "Sticky note", "Pin a comment to the page"],
      ["G / I", "Signature / stamp", "Place a signature or an image"],
      ["E", "Eraser", "Click or drag over ink to remove it"],
      ["R", "Rectangle", "Shift makes it a square"],
      ["Ctrl S", "Save PDF", "Download the annotated copy"],
      ["Ctrl F", "Find", "Search across every page"],
      ["Ctrl Z", "Undo", "Ctrl Shift Z redoes"],
      ["Esc", "Back to select", "Also closes editors and popups"],
    ];

    const col1 = M;
    const col2 = M + 78;
    const col3 = M + 210;
    page.drawText("KEY", { x: col1, y, size: 8.5, font: bold, color: ACCENT, characterSpacing: 1.2 });
    page.drawText("ACTION", { x: col2, y, size: 8.5, font: bold, color: ACCENT, characterSpacing: 1.2 });
    page.drawText("NOTES", { x: col3, y, size: 8.5, font: bold, color: ACCENT, characterSpacing: 1.2 });
    y -= 10;
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1, color: RULE });
    y -= 18;

    for (const [key, action, note] of rows) {
      page.drawText(key, { x: col1, y, size: 10, font: mono, color: INK });
      page.drawText(action, { x: col2, y, size: 10.5, font: bold, color: INK });
      page.drawText(note, { x: col3, y, size: 10, font: regular, color: MUTED });
      y -= 12;
      page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.5, color: RULE });
      y -= 14;
    }

    y -= 18;
    page.drawText("Colour notes", { x: M, y, size: 15, font: bold, color: INK });
    y -= 24;
    const swatches = [
      [rgb(0.949, 0.757, 0.306), "Sun — the default highlight"],
      [rgb(0.486, 0.788, 0.627), "Mint — a cooler pass"],
      [rgb(0.435, 0.698, 0.941), "Sky — for references"],
      [rgb(0.847, 0.282, 0.165), "Vermilion — the brand mark"],
    ];
    for (const [c, label] of swatches) {
      page.drawRectangle({ x: M, y: y - 10, width: 22, height: 22, color: c, opacity: 0.85 });
      page.drawText(label, { x: M + 34, y: y - 3, size: 10.5, font: regular, color: INK });
      y -= 32;
    }
    footer(page, 2, total);
  }

  {
    const page = doc.addPage([W, H]);
    header(page, "Notes");
    let y = H - 120;
    page.drawText("Marking this page", { x: M, y, size: 24, font: bold, color: INK });
    y -= 30;

    y = para(
      page,
      "This last page is deliberately plain. Use it as scratch space: scribble with the pen, stamp a signature, drop a note in the margin, or highlight whichever line you disagree with. Nothing here is precious.",
      M,
      y,
      11.5,
      regular,
      INK,
      W - 2 * M,
      17
    );
    y -= 30;

    page.drawText("A short checklist", { x: M, y, size: 15, font: bold, color: INK });
    y -= 26;
    const items = [
      "Highlight this sentence to test text marks.",
      "Draw a circle around the word checklist.",
      "Write a note in the margin with N.",
      "Sign your name at the bottom.",
      "Export the result with Ctrl S.",
    ];
    for (const item of items) {
      page.drawRectangle({ x: M, y: y - 8, width: 12, height: 12, borderColor: MUTED, borderWidth: 1 });
      page.drawText(item, { x: M + 24, y: y - 5, size: 11, font: regular, color: INK });
      y -= 30;
    }

    y -= 24;
    page.drawText("Signature", { x: M, y, size: 9, font: bold, color: MUTED, characterSpacing: 1.2 });
    page.drawLine({ start: { x: M, y: y - 44 }, end: { x: M + 240, y: y - 44 }, thickness: 1, color: RULE });
    page.drawText("Date", { x: M + 300, y, size: 9, font: bold, color: MUTED, characterSpacing: 1.2 });
    page.drawLine({ start: { x: M + 300, y: y - 44 }, end: { x: W - M, y: y - 44 }, thickness: 1, color: RULE });
    footer(page, 3, total);
  }

  const bytes = await doc.save();
  const outDir = join(root, "extension/samples");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "sample.pdf"), bytes);
  mkdirSync(join(root, "samples"), { recursive: true });
  writeFileSync(join(root, "samples/sample.pdf"), bytes);
  console.log(`sample.pdf written (${bytes.length} bytes)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
