/** CSV duplicate detection for a review-provider export.
 *
 * Exists because Judge.me's API cannot expose more than 10,000 reviews — page 100 is the ceiling and
 * every filter/sort parameter is silently ignored — so a store with ~300,000 published reviews can
 * only be checked in full from an export file.
 *
 * Runs in the browser: a full export is tens of megabytes, well past the 4.5MB request-body limit,
 * and the findings are far smaller than the input.
 */

/** Minimal RFC4180-ish parser: handles quoted fields, embedded commas, newlines and "" escapes.
 * Written by hand rather than adding a dependency, since this is the only CSV in the app. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      field = "";
      // Ignore the blank row a trailing newline produces.
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else if (char !== "\r") {
      field += char;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Maps whatever the export calls its columns onto what detection needs. Judge.me's own export and
 * hand-rolled ones disagree on names, and a body column is often absent entirely. */
export type ColumnMap = {
  id: number;
  productKey: number;
  productTitle: number;
  reviewer: number;
  content: number;
  contentIsTitleOnly: boolean;
  createdAt: number;
};

const CANDIDATES = {
  id: ["judgeme_review_id", "review_id", "id"],
  productKey: ["product_handle", "handle", "product_external_id", "product_id"],
  productTitle: ["product_title", "product", "product_name"],
  reviewer: ["reviewer_name", "reviewer", "name", "author"],
  body: ["body", "review_body", "content", "review_content", "review"],
  title: ["review_title", "title", "headline"],
  createdAt: ["created_at", "date", "review_date"],
};

function findColumn(header: string[], names: string[]): number {
  const normalised = header.map((h) => h.trim().toLowerCase());
  for (const name of names) {
    const index = normalised.indexOf(name);
    if (index !== -1) return index;
  }
  return -1;
}

export function mapColumns(header: string[]): ColumnMap | { error: string } {
  const id = findColumn(header, CANDIDATES.id);
  const productKey = findColumn(header, CANDIDATES.productKey);
  const reviewer = findColumn(header, CANDIDATES.reviewer);
  const body = findColumn(header, CANDIDATES.body);
  const title = findColumn(header, CANDIDATES.title);

  if (id === -1) return { error: "No review id column found (expected judgeme_review_id or id)" };
  if (productKey === -1) return { error: "No product column found (expected product_handle or product_external_id)" };
  if (reviewer === -1) return { error: "No reviewer name column found" };
  // Body is preferred; a title-only export still catches repeated headlines, which is a useful
  // proxy, but the caller is told so it can say what was and wasn't checked.
  if (body === -1 && title === -1) return { error: "No review text column found (body or title)" };

  return {
    id,
    productKey,
    productTitle: findColumn(header, CANDIDATES.productTitle),
    reviewer,
    content: body !== -1 ? body : title,
    contentIsTitleOnly: body === -1,
    createdAt: findColumn(header, CANDIDATES.createdAt),
  };
}

export type CsvFlag = {
  externalReviewId: string;
  productExternalId: string;
  productTitle: string;
  reviewerName: string;
  reason: "CONTENT" | "REVIEWER";
  keptExternalId?: string;
  contentPreview: string;
  reviewCreatedAt?: string | null;
};

export type CsvScanResult = {
  scanned: number;
  flags: CsvFlag[];
  contentIsTitleOnly: boolean;
  duplicateIdsIgnored: number;
};

const norm = (value: string) => value.toLowerCase().replace(/\s+/g, " ").trim();

/** Applies the store's rule — no repeated reviewer name and no repeated text under the same product
 * — grouped by product, keeping the first occurrence of each. */
export function detectDuplicates(rows: string[][], columns: ColumnMap): CsvScanResult {
  const seenByProduct = new Map<string, { names: Map<string, string>; contents: Map<string, string> }>();
  const seenIds = new Set<string>();
  const flags: CsvFlag[] = [];
  let scanned = 0;
  let duplicateIdsIgnored = 0;

  for (const row of rows) {
    const id = (row[columns.id] ?? "").trim();
    const productKey = (row[columns.productKey] ?? "").trim();
    if (!id || !productKey) continue;

    // A review appearing twice in the file is a file artefact, not a duplicate review — the API
    // scan learned this the hard way when a repeating feed produced 40,000 self-matches.
    if (seenIds.has(id)) {
      duplicateIdsIgnored++;
      continue;
    }
    seenIds.add(id);
    scanned++;

    let seen = seenByProduct.get(productKey);
    if (!seen) {
      seen = { names: new Map(), contents: new Map() };
      seenByProduct.set(productKey, seen);
    }

    const content = (row[columns.content] ?? "").trim();
    const reviewer = (row[columns.reviewer] ?? "").trim();
    const contentKey = norm(content);
    const nameKey = norm(reviewer);

    const base = {
      externalReviewId: id,
      productExternalId: productKey,
      productTitle: columns.productTitle !== -1 ? (row[columns.productTitle] ?? "") : "",
      reviewerName: reviewer,
      contentPreview: content,
      reviewCreatedAt: columns.createdAt !== -1 ? (row[columns.createdAt] ?? null) : null,
    };

    const contentMatch = contentKey ? seen.contents.get(contentKey) : undefined;
    if (contentMatch && contentMatch !== id) {
      flags.push({ ...base, reason: "CONTENT", keptExternalId: contentMatch });
      continue;
    }
    const nameMatch = nameKey ? seen.names.get(nameKey) : undefined;
    if (nameMatch && nameMatch !== id) {
      flags.push({ ...base, reason: "REVIEWER", keptExternalId: nameMatch });
      continue;
    }

    if (contentKey) seen.contents.set(contentKey, id);
    if (nameKey) seen.names.set(nameKey, id);
  }

  return { scanned, flags, contentIsTitleOnly: columns.contentIsTitleOnly, duplicateIdsIgnored };
}
