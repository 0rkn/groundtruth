/**
 * The questionnaire as a document a director opens, reads, and marks up.
 *
 * WHY A SEPARATE FILE FROM THE WEB PAGE. The web page is where evidence is CHECKED —
 * every quote sits under its citation, and a consultant reads it before deciding the
 * questionnaire is fit to send. This is what a director actually receives: a plain,
 * printable record they score on paper or on screen, away from the tool. The two have
 * different jobs and are built separately rather than one being a export of the other's
 * markup.
 *
 * WHAT IS KEPT AND WHAT IS DROPPED. Every question, its evidence exactly as verified —
 * quotations with their page, or the honest "no evidence found" line — and the five
 * scale labels to circle. Dropped: the consultant's own working notes (computed figures,
 * signals detected), which are for checking the tool, not for a director's copy.
 */
import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from "docx";
import type { Appraisal, AppraisalQuestion } from "./appraisal.ts";

const SPACE_AFTER = 160; // twentieths of a point; docx's unit throughout

function questionParagraphs(question: AppraisalQuestion, number: number): Paragraph[] {
  const out: Paragraph[] = [
    new Paragraph({
      spacing: { before: 320, after: 80 },
      children: [
        new TextRun({ text: `${number}. `, bold: true }),
        new TextRun({ text: question.text }),
      ],
    }),
  ];

  if (question.state === "evidenced" && question.sources?.length) {
    if (question.summary) {
      out.push(
        new Paragraph({
          indent: { left: 360 },
          spacing: { after: 120 },
          children: [new TextRun({ text: question.summary })],
        }),
      );
    }
    for (const source of question.sources) {
      out.push(
        new Paragraph({
          indent: { left: 360 },
          spacing: { after: 40 },
          children: [new TextRun({ text: `“${source.quote}”`, italics: true })],
        }),
        new Paragraph({
          indent: { left: 360 },
          spacing: { after: SPACE_AFTER },
          children: [
            new TextRun({
              text: source.computed
                ? "Computed from your documents"
                : `${source.document}, page ${source.page}`,
              size: 18,
              color: "555555",
            }),
          ],
        }),
      );
    }
  } else {
    out.push(
      new Paragraph({
        indent: { left: 360 },
        spacing: { after: SPACE_AFTER },
        children: [
          new TextRun({
            text:
              "No evidence found in the documents provided." +
              (question.missingDocument ? ` ${question.missingDocument} would usually cover this.` : ""),
            italics: true,
            color: "555555",
          }),
        ],
      }),
    );
  }

  out.push(
    new Paragraph({
      indent: { left: 360 },
      spacing: { after: 240 },
      children: [
        new TextRun({
          text: `Score:   ${question.scaleLabels.map((l, i) => `${i + 1}. ${l}`).join("     ")}`,
          size: 20,
        }),
      ],
    }),
  );

  return out;
}

export async function appraisalToDocx(appraisal: Appraisal): Promise<Buffer> {
  const children: Paragraph[] = [
    new Paragraph({
      heading: HeadingLevel.TITLE,
      children: [new TextRun("Board appraisal questionnaire")],
    }),
  ];

  if (appraisal.asOf) {
    children.push(
      new Paragraph({
        spacing: { after: 240 },
        children: [new TextRun({ text: appraisal.asOf, color: "555555" })],
      }),
    );
  }

  children.push(
    new Paragraph({
      spacing: { after: 240 },
      alignment: AlignmentType.LEFT,
      children: [
        new TextRun({
          text: `${appraisal.questionCount} questions — ${appraisal.counts.evidenced} with evidence from the documents, ${appraisal.counts.standard} answered from your own knowledge of the board.`,
          size: 20,
          color: "555555",
        }),
      ],
    }),
  );

  let number = 0;
  for (const theme of appraisal.themes) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 400, after: 120 },
        children: [new TextRun(theme.name)],
      }),
    );
    for (const question of theme.questions) {
      number += 1;
      children.push(...questionParagraphs(question, number));
    }
  }

  const doc = new Document({
    sections: [{ children }],
    styles: {
      default: {
        document: { run: { font: "Calibri", size: 22 } },
      },
    },
  });

  return Packer.toBuffer(doc);
}
