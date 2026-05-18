import { formatCompactDateTime } from "@/lib/format";
import type { ReportPayload } from "@/lib/reportData";

function escapePdfText(text: string) {
  return text.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
}

function pdfText(text: string, x: number, y: number, size = 10) {
  return `BT /F1 ${size} Tf ${x} ${y} Td (${escapePdfText(text)}) Tj ET`;
}

function line(x1: number, y1: number, x2: number, y2: number) {
  return `${x1} ${y1} m ${x2} ${y2} l S`;
}

function pointMark(x: number, y: number, radius = 2) {
  return `${(x - radius).toFixed(2)} ${(y - radius).toFixed(2)} ${(radius * 2).toFixed(2)} ${(radius * 2).toFixed(2)} re f`;
}

function buildPageContent(payload: ReportPayload) {
  const rows = payload.rows;
  const content: string[] = [
    "0.1 w",
    pdfText("TB Meter Report", 50, 790, 18),
    pdfText(payload.programName, 50, 766, 12),
    pdfText(payload.dateRange, 50, 748, 10)
  ];

  const chart = {
    x: 55,
    y: 430,
    width: 500,
    height: 250
  };
  content.push(pdfText("Width vs Time", chart.x, chart.y + chart.height + 18, 12));
  content.push(line(chart.x, chart.y, chart.x + chart.width, chart.y));
  content.push(line(chart.x, chart.y, chart.x, chart.y + chart.height));

  if (rows.length > 0) {
    const minTime = Math.min(...rows.map((row) => new Date(row.timestamp).getTime()));
    const maxTime = Math.max(...rows.map((row) => new Date(row.timestamp).getTime()));
    const minWidth = Math.min(...rows.map((row) => row.width));
    const maxWidth = Math.max(...rows.map((row) => row.width));
    const timeRange = Math.max(1, maxTime - minTime);
    const widthRange = Math.max(0.0001, maxWidth - minWidth);
    const points = rows.map((row) => {
      const time = new Date(row.timestamp).getTime();
      const x = chart.x + ((time - minTime) / timeRange) * chart.width;
      const y = chart.y + ((row.width - minWidth) / widthRange) * chart.height;
      return { x, y };
    });

    content.push("0 0.38 0.55 RG");
    points.forEach((point, index) => {
      if (index === 0) {
        content.push(`${point.x.toFixed(2)} ${point.y.toFixed(2)} m`);
      } else {
        content.push(`${point.x.toFixed(2)} ${point.y.toFixed(2)} l`);
      }
    });
    content.push("S");
    content.push("0.02 0.45 0.26 rg");
    points.forEach((point) => content.push(pointMark(point.x, point.y, 2.2)));
    content.push("0 0 0 RG 0 0 0 rg");
    content.push(pdfText(`${minWidth.toFixed(2)}`, 20, chart.y - 3, 8));
    content.push(pdfText(`${maxWidth.toFixed(2)}`, 20, chart.y + chart.height - 3, 8));
    content.push(pdfText(formatCompactDateTime(rows[0].timestamp), chart.x, chart.y - 20, 8));
    content.push(pdfText(formatCompactDateTime(rows[rows.length - 1].timestamp), chart.x + chart.width - 120, chart.y - 20, 8));
  } else {
    content.push(pdfText("No data for selected filters.", chart.x + 150, chart.y + 125, 11));
  }

  content.push(pdfText("Timestamp", 55, 390, 10));
  content.push(pdfText("Width", 300, 390, 10));
  rows.slice(0, 12).forEach((row, index) => {
    const y = 370 - index * 18;
    content.push(pdfText(formatCompactDateTime(row.timestamp), 55, y, 9));
    content.push(pdfText(row.width.toFixed(2), 300, y, 9));
  });

  if (rows.length > 12) {
    content.push(pdfText(`Showing first 12 rows of ${rows.length}. Export CSV for all data.`, 55, 140, 9));
  }

  return content.join("\n");
}

export function reportPayloadToPdf(payload: ReportPayload) {
  const content = buildPageContent(payload);
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(content, "utf8")} >>\nstream\n${content}\nendstream`
  ];

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(pdf, "utf8");
}
